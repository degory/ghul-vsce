#!/usr/bin/env node
'use strict';

// The server picks its transport from the command line. Editors that spawn a
// language server over a pipe usually pass --stdio explicitly, but not all do,
// and the underlying library exits with an obscure error when no transport is
// named at all. Default to stdio so a bare invocation works.

const transports = ['--stdio', '--node-ipc'];
const transport_prefixes = ['--socket=', '--pipe='];

const has_transport = process.argv.slice(2).some(argument =>
    transports.includes(argument) ||
    transport_prefixes.some(prefix => argument.startsWith(prefix)));

if (!has_transport) {
    process.argv.push('--stdio');
}

require('../out/server.js');
