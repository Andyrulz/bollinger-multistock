import winston from 'winston';
import path from 'path';

export class Logger {
  private logger: winston.Logger;

  constructor() {
    // Ensure logs directory exists
    const logDir = path.join(process.cwd(), 'logs');
    
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf((info: any) => {
          const { level, message, timestamp, stack } = info;
          return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
      ),
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        // File transport for all logs
        new winston.transports.File({
          filename: path.join(logDir, 'trading.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        // Separate file for errors
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      ]
    });
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public error(message: string, error?: any): void {
    if (error) {
      this.logger.error(message, { error: error.message, stack: error.stack });
    } else {
      this.logger.error(message);
    }
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public log(level: string, message: string, meta?: any): void {
    this.logger.log(level, message, meta);
  }
}