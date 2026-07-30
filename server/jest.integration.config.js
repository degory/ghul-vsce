// Separate from the default jest config in package.json: this tier spawns a
// real compiled server.js against a real dotnet-restored ghūl project and a
// real ghul.compiler child process, so it needs network access and runs in
// seconds rather than milliseconds. Kept out of `npx jest` (the default
// config's roots exclude this directory) so the fast, fully-mocked unit
// suite stays fast and dependency-free.
module.exports = {
    roots: ['<rootDir>/integration-tests'],
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.ts$': [
            'babel-jest',
            {
                presets: [
                    ['@babel/preset-env', { targets: { node: 'current' } }],
                    '@babel/preset-typescript',
                ],
            },
        ],
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 180000,
};
