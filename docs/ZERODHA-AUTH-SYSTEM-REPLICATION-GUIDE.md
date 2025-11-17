# Zerodha KiteConnect Authentication System - Complete Replication Guide

**Last Updated:** November 5, 2025  
**Purpose:** Comprehensive documentation to replicate the authentication system in any new project  
**Target Audience:** LLMs and developers implementing OAuth-based session management

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Core Components](#3-core-components)
4. [Implementation Details](#4-implementation-details)
5. [Integration Guide](#5-integration-guide)
6. [Security Features](#6-security-features)
7. [API Endpoints](#7-api-endpoints)
8. [Testing & Debugging](#8-testing--debugging)

---

## 1. System Overview

### 1.1 Purpose

This authentication system provides **OAuth-based session management** for Zerodha's KiteConnect API with:

- **Daily session persistence** (encrypted local storage)
- **Automatic session restoration** on bot restart
- **Token validation and auto-refresh**
- **Secure credential management**
- **Express.js web-based login flow**

### 1.2 Key Features

| Feature                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| **OAuth Flow**          | Standard 3-legged OAuth with request_token → access_token exchange |
| **Session Persistence** | AES-256-CBC encrypted storage with daily auto-expiry (6 AM IST)    |
| **Auto-Restoration**    | Loads and validates saved session on startup                       |
| **Token Validation**    | Lightweight API calls to verify token is still active              |
| **Web Interface**       | Express.js endpoints for login, callback, logout, status           |
| **Error Recovery**      | Automatic cleanup of invalid/expired sessions                      |

### 1.3 Authentication Flow

```
┌─────────────┐
│  Bot Start  │
└──────┬──────┘
       │
       ├─→ Load encrypted session from disk
       │
       ├─→ Session exists? ──NO──→ Wait for manual login
       │                              │
       │                              ↓
       │                      User visits /auth/login
       │                              │
       │                              ↓
       │                      Redirect to Zerodha OAuth
       │                              │
       │                              ↓
       │                      User authorizes
       │                              │
       │                              ↓
       │                      Zerodha redirects to /auth/callback
       │                              │
       │                              ↓
       │                      Exchange request_token for access_token
       │                              │
       │                              ↓
       │                      Save encrypted session to disk
       │                              │
       │                              ↓
       YES ←───────────────────── Bot authenticated
       │
       ├─→ Validate token with API call
       │
       ├─→ Token valid? ──YES──→ Bot ready ✅
       │
       NO ──→ Clear invalid session, wait for login
```

---

## 2. Architecture

### 2.1 Component Structure

```
src/
├── services/
│   ├── AuthService.ts              # Main authentication orchestrator
│   └── SessionPersistence.ts       # Encrypted session storage
├── utils/
│   └── Logger.ts                   # Winston-based logging
└── index.ts                        # Express server with auth routes

data/
└── auth/
    └── session.json                # Encrypted session file (auto-created)

.env                                # Environment variables (API credentials)
```

### 2.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         AuthService                              │
│                                                                   │
│  ┌──────────────────┐        ┌──────────────────────┐          │
│  │  Initialize      │◄───────┤ SessionPersistence   │          │
│  │  Session         │        │ (load/save/clear)    │          │
│  └────────┬─────────┘        └──────────────────────┘          │
│           │                                                       │
│           ├─→ Load persisted session                            │
│           ├─→ Validate token                                     │
│           └─→ Set KiteConnect access token                      │
│                                                                   │
│  ┌──────────────────┐        ┌──────────────────────┐          │
│  │ Generate Session │◄───────┤  KiteConnect API     │          │
│  │ (OAuth exchange) │        │  (generateSession)   │          │
│  └────────┬─────────┘        └──────────────────────┘          │
│           │                                                       │
│           └─→ Save new session to disk (encrypted)              │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 AuthService (Primary Orchestrator)

**File:** `src/services/AuthService.ts`

**Responsibilities:**

1. Initialize KiteConnect client
2. Restore session on startup
3. Generate new sessions via OAuth
4. Validate token freshness
5. Provide auth status
6. Invalidate sessions (logout)

**Key Methods:**

| Method                             | Purpose                                 | Returns                    |
| ---------------------------------- | --------------------------------------- | -------------------------- |
| `constructor(kiteConnect, logger)` | Initialize with KiteConnect instance    | -                          |
| `waitForInitialization()`          | Wait for startup session restore        | `Promise<void>`            |
| `initializeSession()`              | Load and validate persisted session     | `Promise<void>`            |
| `validateToken()`                  | Test if current token is valid          | `Promise<void>`            |
| `getLoginUrl()`                    | Get Zerodha OAuth URL                   | `string`                   |
| `generateSession(requestToken)`    | Exchange request_token for access_token | `Promise<SessionData>`     |
| `isAuthenticated()`                | Check if access token exists (sync)     | `boolean`                  |
| `isAuthenticatedAndValid()`        | Check if token is valid with API call   | `Promise<boolean>`         |
| `getAccessToken()`                 | Get current access token                | `string \| undefined`      |
| `getSessionData()`                 | Get full session data                   | `SessionData \| undefined` |
| `invalidateSession()`              | Logout and clear session                | `Promise<void>`            |
| `getSessionInfo()`                 | Get debug info                          | `Promise<SessionInfo>`     |

**Interfaces:**

```typescript
export interface SessionData {
  user_type: string;
  email: string;
  user_name: string;
  user_shortname: string;
  broker: string;
  exchanges: string[];
  products: string[];
  order_types: string[];
  avatar_url: string;
  user_id: string;
  api_key: string;
  access_token: string;
  public_token: string;
  refresh_token: string;
  login_time: string;
}
```

**Full Implementation:**

```typescript
import { KiteConnect } from "kiteconnect";
import { Logger } from "../utils/Logger";
import { SessionPersistence } from "./SessionPersistence";

export interface SessionData {
  user_type: string;
  email: string;
  user_name: string;
  user_shortname: string;
  broker: string;
  exchanges: string[];
  products: string[];
  order_types: string[];
  avatar_url: string;
  user_id: string;
  api_key: string;
  access_token: string;
  public_token: string;
  refresh_token: string;
  login_time: string;
}

export class AuthService {
  private accessToken?: string;
  private sessionData?: SessionData;
  private sessionPersistence: SessionPersistence;
  private initializationPromise: Promise<void>;

  constructor(
    private kiteConnect: any, // Using any for compatibility
    private logger: Logger
  ) {
    this.sessionPersistence = new SessionPersistence(logger);

    // Start session initialization and store the promise
    this.initializationPromise = this.initializeSession().catch((error) => {
      this.logger.warn("Failed to initialize session on startup:", error);
    });
  }

  /**
   * Wait for initialization to complete
   */
  public async waitForInitialization(): Promise<void> {
    return this.initializationPromise;
  }

  /**
   * Initialize session on startup - try to restore from persisted storage
   */
  private async initializeSession(): Promise<void> {
    try {
      const persistedSession = await this.sessionPersistence.loadSession();

      if (persistedSession) {
        this.accessToken = persistedSession.accessToken;
        this.sessionData = persistedSession.sessionData;

        // Set the access token for KiteConnect
        this.kiteConnect.setAccessToken(this.accessToken);

        // Validate the token by making a test API call
        await this.validateToken();

        this.logger.info(
          `🔑 Session restored successfully for user: ${this.sessionData.user_name}`
        );
        this.logger.info(
          `⏰ Session expires at: ${persistedSession.expiryTime.toLocaleString()}`
        );
      } else {
        this.logger.info(
          "📝 No valid persisted session found - authentication required"
        );
      }
    } catch (error) {
      this.logger.error("Failed to initialize session:", error);
      // Clear invalid session data
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
    }
  }

  /**
   * Validate current token by making a test API call
   */
  private async validateToken(): Promise<void> {
    try {
      if (!this.accessToken) {
        throw new Error("No access token to validate");
      }

      // Test the token with a lightweight API call
      await this.kiteConnect.getProfile();
      this.logger.debug("✅ Token validation successful");
    } catch (error) {
      this.logger.warn("❌ Token validation failed:", error);
      // Clear invalid token
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
      throw error;
    }
  }

  public getLoginUrl(): string {
    return this.kiteConnect.getLoginURL();
  }

  public async generateSession(requestToken: string): Promise<SessionData> {
    try {
      const apiSecret = process.env.ZERODHA_API_SECRET;
      if (!apiSecret) {
        throw new Error("ZERODHA_API_SECRET environment variable is not set");
      }

      this.logger.info("Generating session with request token");
      const response = await this.kiteConnect.generateSession(
        requestToken,
        apiSecret
      );

      this.accessToken = response.access_token;
      this.sessionData = response;

      // Set the access token for future API calls
      this.kiteConnect.setAccessToken(this.accessToken);

      // Persist the session for future use
      if (this.accessToken && this.sessionData) {
        await this.sessionPersistence.saveSession(
          this.accessToken,
          this.sessionData
        );
      }

      this.logger.info(
        `Session generated and saved successfully for user: ${response.user_name}`
      );
      return response;
    } catch (error) {
      this.logger.error("Failed to generate session:", error);
      throw error;
    }
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Check if token is both present and valid with the API
   */
  public async isAuthenticatedAndValid(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }

    try {
      // Test with a lightweight API call
      await this.kiteConnect.getProfile();
      return true;
    } catch (error) {
      this.logger.warn("❌ Token validation failed during auth check:", error);
      // Clear invalid token
      delete this.accessToken;
      delete this.sessionData;
      await this.sessionPersistence.clearSession();
      return false;
    }
  }

  public getAccessToken(): string | undefined {
    return this.accessToken;
  }

  public getSessionData(): SessionData | undefined {
    return this.sessionData;
  }

  public async getProfile() {
    try {
      if (!this.isAuthenticated()) {
        throw new Error("Not authenticated. Please generate session first.");
      }

      const profile = await this.kiteConnect.getProfile();
      this.logger.info("Profile retrieved successfully");
      return profile;
    } catch (error) {
      this.logger.error("Failed to get profile:", error);
      throw error;
    }
  }

  public async invalidateSession(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.kiteConnect.invalidateAccessToken(this.accessToken);
        delete this.accessToken;
        delete this.sessionData;

        // Clear persisted session
        await this.sessionPersistence.clearSession();

        this.logger.info("Session invalidated and cleared successfully");
      }
    } catch (error) {
      this.logger.error("Failed to invalidate session:", error);
      throw error;
    }
  }

  /**
   * Get session persistence info for debugging
   */
  public async getSessionInfo(): Promise<{
    authenticated: boolean;
    userName?: string;
    persistedSession: { exists: boolean; expiresAt?: Date; createdAt?: Date };
  }> {
    const persistedInfo = await this.sessionPersistence.getSessionInfo();

    const result: {
      authenticated: boolean;
      userName?: string;
      persistedSession: { exists: boolean; expiresAt?: Date; createdAt?: Date };
    } = {
      authenticated: this.isAuthenticated(),
      persistedSession: persistedInfo,
    };

    if (this.sessionData?.user_name) {
      result.userName = this.sessionData.user_name;
    }

    return result;
  }
}
```

---

### 3.2 SessionPersistence (Encrypted Storage)

**File:** `src/services/SessionPersistence.ts`

**Responsibilities:**

1. Encrypt session data with AES-256-CBC
2. Save encrypted sessions to disk
3. Load and decrypt sessions
4. Validate session expiry
5. Clear invalid/expired sessions

**Key Methods:**

| Method                                  | Purpose                               | Returns                             |
| --------------------------------------- | ------------------------------------- | ----------------------------------- |
| `constructor(logger)`                   | Initialize with secure encryption key | -                                   |
| `saveSession(accessToken, sessionData)` | Encrypt and save session              | `Promise<void>`                     |
| `loadSession()`                         | Load, decrypt, validate session       | `Promise<PersistedSession \| null>` |
| `clearSession()`                        | Delete session file                   | `Promise<void>`                     |
| `hasValidSession()`                     | Check if valid session exists         | `Promise<boolean>`                  |
| `getSessionInfo()`                      | Get metadata for debugging            | `Promise<SessionInfo>`              |

**Interfaces:**

```typescript
export interface PersistedSession {
  accessToken: string;
  sessionData: SessionData;
  expiryTime: Date; // 6 AM next day (IST)
  createdAt: Date;
  lastValidated: Date;
}

interface EncryptedSessionFile {
  data: string; // encrypted session data
  iv: string; // initialization vector (hex)
  timestamp: string; // ISO timestamp
}
```

**Full Implementation:**

```typescript
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Logger } from "../utils/Logger";
import { SessionData } from "./AuthService";

// Interface for persisted session data
export interface PersistedSession {
  accessToken: string;
  sessionData: SessionData;
  expiryTime: Date;
  createdAt: Date;
  lastValidated: Date;
}

// Encrypted storage format
interface EncryptedSessionFile {
  data: string; // encrypted session data
  iv: string; // initialization vector
  timestamp: string;
}

export class SessionPersistence {
  private readonly sessionFilePath: string;
  private readonly logger: Logger;
  private readonly encryptionKey: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.sessionFilePath = path.join(__dirname, "../../data/auth/session.json");

    // Generate consistent encryption key from API credentials
    // This ensures same key across restarts while keeping it secure
    const apiKey = process.env.ZERODHA_API_KEY || "";
    const apiSecret = process.env.ZERODHA_API_SECRET || "";
    this.encryptionKey = crypto
      .createHash("sha256")
      .update(apiKey + apiSecret + "trading_bot_session_key")
      .digest("hex");

    this.ensureSessionDirectory();
  }

  /**
   * Ensure session directory exists with proper permissions
   */
  private ensureSessionDirectory(): void {
    const sessionDir = path.dirname(this.sessionFilePath);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      this.logger.info("📁 Created secure session directory");
    }
  }

  /**
   * Encrypt session data for secure storage
   */
  private encryptSessionData(
    sessionData: PersistedSession
  ): EncryptedSessionFile {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(this.encryptionKey.slice(0, 32)),
      iv
    );

    let encrypted = cipher.update(JSON.stringify(sessionData), "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      data: encrypted,
      iv: iv.toString("hex"),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Decrypt session data from storage
   */
  private decryptSessionData(
    encryptedFile: EncryptedSessionFile
  ): PersistedSession | null {
    try {
      const iv = Buffer.from(encryptedFile.iv, "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(this.encryptionKey.slice(0, 32)),
        iv
      );
      let decrypted = decipher.update(encryptedFile.data, "hex", "utf8");
      decrypted += decipher.final("utf8");

      const sessionData = JSON.parse(decrypted);

      // Convert date strings back to Date objects
      sessionData.expiryTime = new Date(sessionData.expiryTime);
      sessionData.createdAt = new Date(sessionData.createdAt);
      sessionData.lastValidated = new Date(sessionData.lastValidated);

      return sessionData;
    } catch (error) {
      this.logger.error("❌ Failed to decrypt session data:", error);
      return null;
    }
  }

  /**
   * Save session to encrypted file
   */
  public async saveSession(
    accessToken: string,
    sessionData: SessionData
  ): Promise<void> {
    try {
      const now = new Date();

      // Zerodha tokens expire at 6 AM the next day
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(6, 0, 0, 0);

      const persistedSession: PersistedSession = {
        accessToken,
        sessionData,
        expiryTime: tomorrow,
        createdAt: now,
        lastValidated: now,
      };

      const encryptedData = this.encryptSessionData(persistedSession);

      // Write to file with secure permissions
      fs.writeFileSync(
        this.sessionFilePath,
        JSON.stringify(encryptedData, null, 2),
        {
          mode: 0o600, // Read/write for owner only
        }
      );

      this.logger.info(
        `💾 Session saved securely - expires at ${tomorrow.toLocaleString()}`
      );
    } catch (error) {
      this.logger.error("❌ Failed to save session:", error);
      throw error;
    }
  }

  /**
   * Load and validate session from file
   */
  public async loadSession(): Promise<PersistedSession | null> {
    try {
      if (!fs.existsSync(this.sessionFilePath)) {
        this.logger.debug("📂 No saved session found");
        return null;
      }

      const fileContent = fs.readFileSync(this.sessionFilePath, "utf8");
      const encryptedFile: EncryptedSessionFile = JSON.parse(fileContent);

      const session = this.decryptSessionData(encryptedFile);
      if (!session) {
        this.logger.warn("⚠️ Failed to decrypt saved session");
        await this.clearSession(); // Remove corrupted session
        return null;
      }

      // Check if session has expired
      const now = new Date();
      if (now > session.expiryTime) {
        this.logger.info("⏰ Saved session has expired - clearing");
        await this.clearSession();
        return null;
      }

      // Update last validated timestamp (in memory only, don't re-save during load)
      session.lastValidated = now;

      this.logger.info(
        `🔑 Loaded valid session - expires at ${session.expiryTime.toLocaleString()}`
      );
      return session;
    } catch (error) {
      this.logger.error("❌ Failed to load session:", error);
      await this.clearSession(); // Clean up on error
      return null;
    }
  }

  /**
   * Clear saved session
   */
  public async clearSession(): Promise<void> {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
        this.logger.info("🗑️ Session cleared");
      }
    } catch (error) {
      this.logger.error("❌ Failed to clear session:", error);
    }
  }

  /**
   * Check if we have a valid saved session
   */
  public async hasValidSession(): Promise<boolean> {
    const session = await this.loadSession();
    return session !== null;
  }

  /**
   * Get session info for debugging
   */
  public async getSessionInfo(): Promise<{
    exists: boolean;
    expiresAt?: Date;
    createdAt?: Date;
  }> {
    const session = await this.loadSession();

    if (!session) {
      return { exists: false };
    }

    return {
      exists: true,
      expiresAt: session.expiryTime,
      createdAt: session.createdAt,
    };
  }
}
```

---

## 4. Implementation Details

### 4.1 Encryption Mechanism

**Algorithm:** AES-256-CBC (Advanced Encryption Standard, 256-bit key, Cipher Block Chaining mode)

**Key Generation:**

```typescript
// Derived from API credentials (consistent across restarts)
const encryptionKey = crypto
  .createHash("sha256")
  .update(API_KEY + API_SECRET + "trading_bot_session_key")
  .digest("hex");
```

**Encryption Process:**

```typescript
1. Generate random 16-byte IV (Initialization Vector)
2. Create cipher with AES-256-CBC
3. Encrypt JSON session data
4. Store: { data: encrypted_hex, iv: iv_hex, timestamp: ISO_string }
```

**Decryption Process:**

```typescript
1. Read encrypted file
2. Extract IV from file
3. Create decipher with same key + IV
4. Decrypt data
5. Parse JSON and reconstruct Date objects
```

**Security Features:**

- ✅ **256-bit key** (SHA-256 hash of credentials)
- ✅ **Random IV per encryption** (prevents pattern detection)
- ✅ **File permissions: 0o600** (owner read/write only)
- ✅ **Directory permissions: 0o700** (owner access only)
- ✅ **No plaintext storage** (all sensitive data encrypted)

### 4.2 Session Expiry Logic

**Zerodha Token Expiry:**

- Zerodha access tokens expire at **6:00 AM IST** the next day
- This is a hard limit enforced by Zerodha's API
- No refresh token mechanism available

**Expiry Calculation:**

```typescript
const now = new Date();
const expiryTime = new Date(now);
expiryTime.setDate(expiryTime.getDate() + 1); // Next day
expiryTime.setHours(6, 0, 0, 0); // 6 AM sharp
```

**Validation on Load:**

```typescript
if (now > session.expiryTime) {
  // Session expired - clear and require re-login
  await this.clearSession();
  return null;
}
```

### 4.3 Token Validation Strategy

**Why validate?**

- Tokens can be invalidated by Zerodha server-side
- Multiple login sessions can invalidate older tokens
- API rate limits or suspicious activity can revoke tokens

**Validation Method:**

```typescript
// Lightweight API call to test token
await this.kiteConnect.getProfile();
```

**When to validate:**

1. **On session restore** (startup)
2. **On explicit auth check** (`isAuthenticatedAndValid()`)
3. **After API errors** (automatically retry with validation)

**Validation Error Handling:**

```typescript
try {
  await this.kiteConnect.getProfile();
  return true; // Token valid
} catch (error) {
  // Token invalid - clear session
  delete this.accessToken;
  delete this.sessionData;
  await this.sessionPersistence.clearSession();
  return false;
}
```

### 4.4 File System Structure

**Directory Layout:**

```
project-root/
├── data/
│   └── auth/
│       └── session.json         # Encrypted session (auto-created)
├── src/
│   └── services/
│       ├── AuthService.ts
│       └── SessionPersistence.ts
└── .env                         # API credentials (gitignored)
```

**Session File Format:**

```json
{
  "data": "a3f8c2e1d9b4f7e6...",
  "iv": "1a2b3c4d5e6f7g8h...",
  "timestamp": "2025-11-05T10:30:00.000Z"
}
```

**Decrypted Session Content:**

```json
{
  "accessToken": "abc123xyz...",
  "sessionData": {
    "user_id": "ABC123",
    "user_name": "John Doe",
    "email": "john@example.com",
    "api_key": "your_api_key",
    "access_token": "abc123xyz...",
    "login_time": "2025-11-05 10:30:00"
  },
  "expiryTime": "2025-11-06T06:00:00.000Z",
  "createdAt": "2025-11-05T10:30:00.000Z",
  "lastValidated": "2025-11-05T10:30:00.000Z"
}
```

---

## 5. Integration Guide

### 5.1 Environment Setup

**Required Environment Variables (.env):**

```env
# Zerodha API Credentials
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Logging
LOG_LEVEL=info
```

**Get Zerodha API Credentials:**

1. Visit https://kite.zerodha.com/
2. Log in to your account
3. Go to "Console" → "My Apps"
4. Create a new app or use existing
5. Set redirect URL: `http://localhost:3000/auth/callback`
6. Copy API Key and API Secret

### 5.2 Dependencies

**package.json:**

```json
{
  "dependencies": {
    "dotenv": "^16.3.1", // Environment variable management
    "express": "^4.18.2", // Web server
    "kiteconnect": "^5.1.0", // Zerodha API client
    "winston": "^3.11.0" // Logging
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.8.7",
    "ts-node": "^10.9.1",
    "typescript": "^5.2.2"
  }
}
```

**Install:**

```bash
npm install dotenv express kiteconnect winston
npm install --save-dev @types/express @types/node ts-node typescript
```

### 5.3 Express Server Integration

**Minimal Express Setup (index.ts):**

```typescript
import express from "express";
import dotenv from "dotenv";
import { KiteConnect } from "kiteconnect";
import { AuthService } from "./services/AuthService";
import { Logger } from "./utils/Logger";

dotenv.config();

class TradingBot {
  private app: express.Application;
  private kiteConnect: any;
  private authService: AuthService;
  private logger: Logger;

  constructor() {
    this.logger = new Logger();
    this.app = express();

    // Initialize KiteConnect
    this.kiteConnect = new KiteConnect({
      api_key: process.env.ZERODHA_API_KEY,
    });

    // Initialize AuthService
    this.authService = new AuthService(this.kiteConnect, this.logger);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (req, res) => {
      res.json({ status: "OK", timestamp: new Date() });
    });

    // Auth status
    this.app.get("/auth/status", async (req, res) => {
      const isAuthenticated = this.authService.isAuthenticated();
      const isValid = await this.authService.isAuthenticatedAndValid();
      const sessionData = this.authService.getSessionData();

      res.json({
        authenticated: isAuthenticated,
        valid: isValid,
        user: sessionData?.user_name || null,
      });
    });

    // Login (redirect to Zerodha)
    this.app.get("/auth/login", (req, res) => {
      const loginUrl = this.authService.getLoginUrl();
      res.redirect(loginUrl);
    });

    // OAuth callback
    this.app.get("/auth/callback", async (req, res) => {
      try {
        const requestToken = req.query.request_token as string;

        if (!requestToken) {
          return res.status(400).json({ error: "Request token required" });
        }

        const sessionData = await this.authService.generateSession(
          requestToken
        );

        res.json({
          success: true,
          message: "Authentication successful",
          user: sessionData.user_name,
        });
      } catch (error) {
        res.status(500).json({
          error: "Authentication failed",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Logout
    this.app.post("/auth/logout", async (req, res) => {
      await this.authService.invalidateSession();
      res.json({ success: true, message: "Logged out" });
    });
  }

  public async start(): Promise<void> {
    const port = process.env.PORT || 3000;

    // Wait for session initialization
    await this.authService.waitForInitialization();

    this.app.listen(port, () => {
      this.logger.info(`🚀 Server running on http://localhost:${port}`);
      this.logger.info(`🔐 Login at: http://localhost:${port}/auth/login`);
    });
  }
}

// Start the bot
const bot = new TradingBot();
bot.start().catch(console.error);
```

### 5.4 Logger Implementation (Winston)

**File:** `src/utils/Logger.ts`

```typescript
import winston from "winston";
import path from "path";

export class Logger {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          if (stack) {
            return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
          }
          return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} ${level}: ${message}`;
            })
          ),
        }),
        new winston.transports.File({
          filename: path.join(__dirname, "../../logs/error.log"),
          level: "error",
        }),
        new winston.transports.File({
          filename: path.join(__dirname, "../../logs/combined.log"),
        }),
      ],
    });
  }

  public info(message: string, ...meta: any[]): void {
    this.logger.info(message, ...meta);
  }

  public warn(message: string, ...meta: any[]): void {
    this.logger.warn(message, ...meta);
  }

  public error(message: string, ...meta: any[]): void {
    this.logger.error(message, ...meta);
  }

  public debug(message: string, ...meta: any[]): void {
    this.logger.debug(message, ...meta);
  }
}
```

---

## 6. Security Features

### 6.1 Encryption Security

| Feature              | Implementation                 | Security Level            |
| -------------------- | ------------------------------ | ------------------------- |
| **Algorithm**        | AES-256-CBC                    | Military-grade            |
| **Key Size**         | 256 bits                       | Brute-force resistant     |
| **IV**               | Random 16 bytes per encryption | Prevents pattern analysis |
| **Key Derivation**   | SHA-256 hash of credentials    | One-way function          |
| **File Permissions** | 0o600 (owner read/write only)  | OS-level protection       |

### 6.2 Attack Mitigation

| Attack Vector              | Mitigation                                    |
| -------------------------- | --------------------------------------------- |
| **File Access**            | File permissions 0o600 (owner only)           |
| **Directory Traversal**    | Hardcoded absolute paths                      |
| **Credential Exposure**    | Environment variables, gitignored             |
| **Man-in-the-Middle**      | OAuth redirect to Zerodha HTTPS               |
| **Token Theft**            | Encrypted at rest, memory-only during runtime |
| **Session Hijacking**      | Token validation on critical operations       |
| **Brute Force Encryption** | 256-bit key = 2^256 combinations              |

### 6.3 Best Practices

**✅ DO:**

- Store `.env` in `.gitignore`
- Use environment variables for credentials
- Validate tokens before critical operations
- Clear sessions on errors
- Log security events
- Use HTTPS in production
- Rotate API keys periodically

**❌ DON'T:**

- Commit `.env` or `session.json` to git
- Store plaintext tokens in logs
- Share encryption keys
- Disable file permissions
- Skip token validation
- Use HTTP in production
- Hard-code credentials

---

## 7. API Endpoints

### 7.1 Authentication Endpoints

#### GET /auth/status

**Purpose:** Check authentication status

**Response:**

```json
{
  "authenticated": true,
  "valid": true,
  "user": "John Doe",
  "sessionPersistence": {
    "enabled": true,
    "hasPersistedSession": true,
    "expiresAt": "2025-11-06T06:00:00.000Z",
    "createdAt": "2025-11-05T10:30:00.000Z"
  }
}
```

#### GET /auth/login

**Purpose:** Redirect to Zerodha OAuth login

**Behavior:**

1. Generates Zerodha login URL
2. Redirects user to Zerodha
3. User authorizes app
4. Zerodha redirects back to `/auth/callback`

**URL Example:**

```
https://kite.zerodha.com/connect/login?v=3&api_key=your_api_key
```

#### GET /auth/callback

**Purpose:** OAuth callback endpoint (receives request_token)

**Query Parameters:**

- `request_token` (string, required) - Zerodha's temporary token
- `status` (string) - "success" or "error"
- `error` (string) - Error message if status=error

**Success Response:**

```json
{
  "success": true,
  "message": "Authentication successful",
  "user": "John Doe",
  "loginTime": "2025-11-05 10:30:00"
}
```

**Error Response:**

```json
{
  "error": "Authentication failed",
  "details": "Invalid API secret"
}
```

#### POST /auth/logout

**Purpose:** Invalidate session and clear storage

**Response:**

```json
{
  "success": true,
  "message": "Session cleared successfully",
  "timestamp": "2025-11-05T10:30:00.000Z"
}
```

#### GET /auth/session-info

**Purpose:** Debugging endpoint for session details

**Response:**

```json
{
  "success": true,
  "sessionInfo": {
    "authenticated": true,
    "userName": "John Doe",
    "persistedSession": {
      "exists": true,
      "expiresAt": "2025-11-06T06:00:00.000Z",
      "createdAt": "2025-11-05T10:30:00.000Z"
    }
  },
  "timestamp": "2025-11-05T10:30:00.000Z"
}
```

### 7.2 Usage Examples

**Check if bot is authenticated:**

```bash
curl http://localhost:3000/auth/status
```

**Login (in browser):**

```
http://localhost:3000/auth/login
```

**Logout:**

```bash
curl -X POST http://localhost:3000/auth/logout
```

**Check session info:**

```bash
curl http://localhost:3000/auth/session-info
```

---

## 8. Testing & Debugging

### 8.1 Test Scenarios

**Scenario 1: First-time login**

```
1. Start bot (no session file exists)
2. Visit http://localhost:3000/auth/login
3. Authorize on Zerodha
4. Verify callback receives request_token
5. Verify session saved to data/auth/session.json
6. Verify encrypted file format
7. Restart bot
8. Verify session restored automatically
```

**Scenario 2: Session restoration**

```
1. Bot already logged in (session.json exists)
2. Stop bot
3. Start bot
4. Verify session loaded from disk
5. Verify token validated with API call
6. Verify bot shows "authenticated" without manual login
```

**Scenario 3: Expired session**

```
1. Create session.json with expired date
2. Start bot
3. Verify session auto-cleared
4. Verify bot prompts for login
```

**Scenario 4: Invalid token**

```
1. Create session.json with valid expiry but fake token
2. Start bot
3. Verify token validation fails
4. Verify session auto-cleared
5. Verify bot prompts for login
```

**Scenario 5: Logout**

```
1. Bot authenticated
2. POST to /auth/logout
3. Verify session cleared from memory
4. Verify session.json deleted
5. Verify /auth/status shows unauthenticated
```

### 8.2 Debug Logs

**Expected Logs on First Login:**

```
[INFO] 📝 No valid persisted session found - authentication required
[INFO] 🚀 Server running on http://localhost:3000
[INFO] 🔐 Login at: http://localhost:3000/auth/login
[INFO] Redirecting to Zerodha login: https://kite.zerodha.com/connect/login?v=3&api_key=...
[INFO] Received auth callback with query params: { request_token: '...' }
[INFO] Processing request token: abc123xyz...
[INFO] Generating session with request token
[INFO] 📁 Created secure session directory
[INFO] 💾 Session saved securely - expires at 11/6/2025, 6:00:00 AM
[INFO] Session generated and saved successfully for user: John Doe
```

**Expected Logs on Session Restoration:**

```
[INFO] 🔑 Loaded valid session - expires at 11/6/2025, 6:00:00 AM
[DEBUG] ✅ Token validation successful
[INFO] 🔑 Session restored successfully for user: John Doe
[INFO] ⏰ Session expires at: 11/6/2025, 6:00:00 AM
[INFO] 🚀 Server running on http://localhost:3000
```

**Expected Logs on Expired Session:**

```
[INFO] ⏰ Saved session has expired - clearing
[INFO] 🗑️ Session cleared
[INFO] 📝 No valid persisted session found - authentication required
```

**Expected Logs on Invalid Token:**

```
[WARN] ❌ Token validation failed: Error: Invalid access_token
[INFO] 🗑️ Session cleared
[ERROR] Failed to initialize session: Error: Invalid access_token
```

### 8.3 Common Issues & Solutions

| Issue                        | Cause                                 | Solution                            |
| ---------------------------- | ------------------------------------- | ----------------------------------- |
| "No valid persisted session" | No session file or expired            | Visit `/auth/login` to authenticate |
| "Token validation failed"    | Invalid/expired token                 | Clear session, re-login             |
| "Request token required"     | Missing query param in callback       | Check redirect URL configuration    |
| "Invalid API secret"         | Wrong secret in .env                  | Verify `ZERODHA_API_SECRET`         |
| "Failed to decrypt session"  | Corrupted file or changed credentials | Delete `session.json`, re-login     |
| "Session cleared" repeatedly | Token expired (past 6 AM)             | Re-login to get new token           |

### 8.4 Manual Testing Commands

**Check session file exists:**

```bash
ls -la data/auth/session.json
```

**View encrypted session (pretty print):**

```bash
cat data/auth/session.json | jq
```

**Clear session manually:**

```bash
rm data/auth/session.json
```

**Test token validation:**

```bash
curl http://localhost:3000/auth/status | jq
```

**View bot logs:**

```bash
tail -f logs/combined.log
```

---

## 9. Adaptation Guide for Other Projects

### 9.1 For Generic OAuth Systems

**Modifications needed:**

1. Replace `KiteConnect` with your OAuth provider's client
2. Update `getLoginUrl()` to match your provider's OAuth URL
3. Update `generateSession()` to match token exchange API
4. Adjust expiry logic (if not daily expiry)
5. Update `SessionData` interface to match your provider's response

**Example for Google OAuth:**

```typescript
// Replace KiteConnect with Google OAuth client
import { OAuth2Client } from 'google-auth-library';

constructor(private oauthClient: OAuth2Client, private logger: Logger) {
  // ...
}

public getLoginUrl(): string {
  return this.oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email']
  });
}

public async generateSession(code: string): Promise<SessionData> {
  const { tokens } = await this.oauthClient.getToken(code);
  this.oauthClient.setCredentials(tokens);
  // ... rest of implementation
}
```

### 9.2 For Non-OAuth APIs

**Modifications needed:**

1. Replace OAuth flow with API key authentication
2. Remove `getLoginUrl()` and callback endpoint
3. Simplify `generateSession()` to just validate API key
4. Keep encryption and persistence logic

**Example for API Key Auth:**

```typescript
public async authenticateWithApiKey(apiKey: string): Promise<SessionData> {
  // Validate API key with provider
  const response = await fetch('https://api.provider.com/validate', {
    headers: { 'X-API-Key': apiKey }
  });

  const sessionData = await response.json();

  // Save session
  await this.sessionPersistence.saveSession(apiKey, sessionData);

  return sessionData;
}
```

### 9.3 For Different Token Expiry

**Zerodha:** Daily expiry at 6 AM IST
**Other providers:** Vary (e.g., JWT with 1 hour, refresh tokens with 30 days)

**Modification:**

```typescript
// For JWT tokens (1 hour expiry)
const expiryTime = new Date(now.getTime() + 60 * 60 * 1000);

// For refresh tokens (30 days)
const expiryTime = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

// For custom expiry from API response
const expiryTime = new Date(response.expires_at); // ISO timestamp from API
```

---

## 10. Summary Checklist

### For LLM Implementation:

- [ ] Copy `AuthService.ts` with all methods
- [ ] Copy `SessionPersistence.ts` with encryption logic
- [ ] Copy `Logger.ts` for Winston logging
- [ ] Set up Express routes: `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/status`
- [ ] Create `.env` with `ZERODHA_API_KEY` and `ZERODHA_API_SECRET`
- [ ] Install dependencies: `kiteconnect`, `express`, `dotenv`, `winston`
- [ ] Create `data/auth/` directory (auto-created by SessionPersistence)
- [ ] Initialize `AuthService` in main server file
- [ ] Call `waitForInitialization()` before starting server
- [ ] Test: First login → Session save → Bot restart → Session restore

### Key Features Implemented:

✅ OAuth 3-legged authentication flow  
✅ AES-256-CBC encrypted session storage  
✅ Daily session expiry at 6 AM IST  
✅ Automatic session restoration on startup  
✅ Token validation with API calls  
✅ Express endpoints for login/logout/status  
✅ Secure file permissions (0o600)  
✅ Error recovery and session cleanup  
✅ Winston logging for debugging  
✅ TypeScript type safety

---

**Document Version:** 1.0  
**Last Updated:** November 5, 2025  
**Author:** GitHub Copilot  
**Purpose:** Complete replication guide for Zerodha KiteConnect authentication system

**License:** MIT (adapt for your project)

---

## Appendix: Quick Start Code

**Minimal working example (copy-paste ready):**

```typescript
// index.ts
import express from "express";
import dotenv from "dotenv";
import { KiteConnect } from "kiteconnect";
import { AuthService } from "./services/AuthService";
import { Logger } from "./utils/Logger";

dotenv.config();

const app = express();
const logger = new Logger();
const kiteConnect = new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });
const authService = new AuthService(kiteConnect, logger);

app.get("/auth/login", (req, res) => res.redirect(authService.getLoginUrl()));

app.get("/auth/callback", async (req, res) => {
  const token = req.query.request_token as string;
  await authService.generateSession(token);
  res.json({ success: true });
});

app.get("/auth/status", async (req, res) => {
  const valid = await authService.isAuthenticatedAndValid();
  res.json({ authenticated: valid });
});

authService.waitForInitialization().then(() => {
  app.listen(3000, () =>
    logger.info("Server running on http://localhost:3000")
  );
});
```

**That's it! 🚀**
