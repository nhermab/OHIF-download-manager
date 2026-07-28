const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/test/**/*.test.js',
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/src/**/*.test.js',
    '<rootDir>/src/**/*.test.ts',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
