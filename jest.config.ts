import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/app/tests/**/*.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 60_000,
};

export default config;
