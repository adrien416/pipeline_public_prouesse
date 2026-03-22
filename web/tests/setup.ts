// Set required environment variables before any module import
// These are test-only values, never used in production
import bcrypt from "bcryptjs";

process.env.JWT_SECRET = "test-secret-for-vitest";
process.env.LOGIN_PASSWORD_HASH = bcrypt.hashSync("test-password", 10);
