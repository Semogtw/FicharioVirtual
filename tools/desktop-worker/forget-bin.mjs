#!/usr/bin/env node

import process from 'node:process';
import { runForgetCli } from './forget-command.mjs';

process.exitCode = await runForgetCli();
