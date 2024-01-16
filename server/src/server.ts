'use strict';

import { log } from 'console';
import { ExtensionState } from './extension-state';

log("extension entry point...")

ExtensionState.getInstance().connect();

log("connected and listening...");


