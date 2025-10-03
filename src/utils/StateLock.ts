/**
 * StateLock - Atomic State Transition Manager
 * 
 * Provides thread-safe state transitions for trading operations
 * Prevents race conditions in entry/exit executions
 * Uses proper Promise-based queuing instead of busy waiting
 */

export class StateLock {
    private locks: Map<string, boolean> = new Map();
    private queues: Map<string, Array<{ resolve: () => void; reject: (error: any) => void; timeout: NodeJS.Timeout }>> = new Map();

    /**
     * Acquire lock for atomic operation with timeout protection
     * @param key Unique lock identifier
     * @param timeoutMs Maximum wait time in milliseconds (default: 30 seconds)
     * @returns Promise that resolves when lock is acquired
     */
    async acquire(key: string, timeoutMs: number = 30000): Promise<() => void> {
        return new Promise((resolve, reject) => {
            // If lock is not held, acquire immediately
            if (!this.locks.get(key)) {
                this.locks.set(key, true);
                resolve(() => {
                    this.locks.delete(key);
                    this.processQueue(key);
                });
                return;
            }

            // Lock is held, add to queue with timeout
            const timeout = setTimeout(() => {
                this.removeFromQueue(key, resolve);
                reject(new Error(`Lock acquisition timeout after ${timeoutMs}ms for key: ${key}`));
            }, timeoutMs);

            const queueEntry = { 
                resolve: () => {
                    clearTimeout(timeout);
                    this.locks.set(key, true);
                    resolve(() => {
                        this.locks.delete(key);
                        this.processQueue(key);
                    });
                }, 
                reject: (error: any) => {
                    clearTimeout(timeout);
                    reject(error);
                },
                timeout
            };

            if (!this.queues.has(key)) {
                this.queues.set(key, []);
            }
            this.queues.get(key)!.push(queueEntry);
        });
    }

    /**
     * Process the next waiting operation in queue
     */
    private processQueue(key: string): void {
        const queue = this.queues.get(key);
        if (queue && queue.length > 0) {
            const next = queue.shift()!;
            next.resolve();
        } else {
            this.queues.delete(key);
        }
    }

    /**
     * Remove specific entry from queue (used for timeouts)
     */
    private removeFromQueue(key: string, resolveFunction: any): void {
        const queue = this.queues.get(key);
        if (queue) {
            const index = queue.findIndex(entry => entry.resolve === resolveFunction);
            if (index >= 0) {
                const removedEntries = queue.splice(index, 1);
                if (removedEntries.length > 0 && removedEntries[0]) {
                    clearTimeout(removedEntries[0].timeout);
                }
            }
        }
    }

    /**
     * Execute operation with atomic lock
     * @param key Lock identifier
     * @param operation Function to execute atomically
     * @param timeoutMs Maximum wait time for lock acquisition
     * @returns Operation result
     */
    async executeAtomic<T>(key: string, operation: () => Promise<T>, timeoutMs: number = 30000): Promise<T> {
        const release = await this.acquire(key, timeoutMs);
        
        try {
            const result = await operation();
            return result;
        } finally {
            release();
        }
    }

    /**
     * Check if lock is currently held
     * @param key Lock identifier
     * @returns True if locked
     */
    isLocked(key: string): boolean {
        return this.locks.get(key) || false;
    }

    /**
     * Get all active locks
     * @returns Array of active lock keys
     */
    getActiveLocks(): string[] {
        return Array.from(this.locks.keys()).filter(key => this.locks.get(key));
    }

    /**
     * Get queue status for monitoring
     * @returns Object with lock and queue information
     */
    getQueueStatus(): { [key: string]: { locked: boolean; queueLength: number } } {
        const status: { [key: string]: { locked: boolean; queueLength: number } } = {};
        
        // Add locked keys
        for (const [key, locked] of this.locks.entries()) {
            status[key] = { locked, queueLength: 0 };
        }
        
        // Add queue lengths
        for (const [key, queue] of this.queues.entries()) {
            if (!status[key]) {
                status[key] = { locked: false, queueLength: queue.length };
            } else {
                status[key].queueLength = queue.length;
            }
        }
        
        return status;
    }
}

// Singleton instance for global state management
export const globalStateLock = new StateLock();