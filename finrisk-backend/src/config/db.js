// ============================================================
// MongoDB connection (Mongoose)
// ============================================================

import mongoose from "mongoose";

export async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) throw new Error("MONGO_URI is not set in .env");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`[MongoDB] Connected to ${uri.replace(/\/\/[^@]*@/, "//***@")}`);
  return mongoose.connection;
}

export function databaseStatus() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] ?? "unknown";
}
