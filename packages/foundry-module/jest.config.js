export default {
  displayName: "foundry-module",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@foundry-bridge/shared$": "<rootDir>/../shared/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  clearMocks: true,
};
