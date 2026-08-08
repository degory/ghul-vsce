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
    // One suite at a time. Suites share fixture projects, and each one cleans
    // the fixture's build output around its own run — concurrently, that is
    // one suite deleting the directory another is building into, which fails
    // as an unrelated ENOENT deep in a dotnet build. They are also several
    // real compilers' worth of work each, so running them side by side buys
    // little even where they do not collide.
    maxWorkers: 1,
};
