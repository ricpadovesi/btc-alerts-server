import { getDb } from "./db.js";
import { sql } from "drizzle-orm";

export async function initializeDatabase() {
  try {
    console.log("[DB] Inicializando banco de dados...");

    const db = await getDb();
    if (!db) {
      throw new Error("Database connection not available");
    }

    // Criar tabela users
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        openId VARCHAR(64) NOT NULL UNIQUE,
        name TEXT,
        email VARCHAR(320),
        loginMethod VARCHAR(64),
        role ENUM('user', 'admin') DEFAULT 'user' NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        lastSignedIn TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);

    console.log("[DB] ✅ Tabela 'users' criada");

    // Criar tabela push_tokens
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token VARCHAR(255) NOT NULL UNIQUE,
        deviceId VARCHAR(255),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        lastUsed TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);

    console.log("[DB] ✅ Tabela 'push_tokens' criada");
    console.log("[DB] ✅ Banco de dados inicializado com sucesso!");

    return { success: true };
  } catch (error) {
    console.error("[DB] ❌ Erro ao inicializar banco:", error);
    throw error;
  }
}
