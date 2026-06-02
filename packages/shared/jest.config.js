export default {
  displayName: "shared",
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  clearMocks: true,
};
