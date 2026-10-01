import { PrismaClient } from "../generated/client/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

export const prisma = new PrismaClient({
	adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }),
	log: ["error", "warn"],
});
