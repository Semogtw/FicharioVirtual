#!/usr/bin/env node

import process from 'node:process';
import { runPairCodeCli } from './pair-code-command.mjs';

process.exitCode = await runPairCodeCli();
