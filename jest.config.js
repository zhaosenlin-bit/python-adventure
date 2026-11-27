/** @type {import('jest').Config} */
const testIgnorePatterns = [
  '/node_modules/',
  '/_archive_20260128/',
  '/scripts/',
  // 「3D迷宫板块」是独立项目的交付拷贝（自带 package.json），
  // 里面的 @/ 路径是相对它自己那层的，根工程的 jest 跑不了。
  '/3D迷宫板块/',
];

const moduleIgnorePatterns = [
  '/\\.next/',
  '/\\.tmp/',
  '/release/',
  '/backend_deploy_tmp/',
];

module.exports = {
  testPathIgnorePatterns: testIgnorePatterns,
  modulePathIgnorePatterns: moduleIgnorePatterns,
  watchPathIgnorePatterns: moduleIgnorePatterns,
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.(spec|test).[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  passWithNoTests: true
};
