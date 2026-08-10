#!/usr/bin/env node

import process from 'node:process';
import { runUnpairCli } from './unpair-command.mjs';

process.exitCode = await runUnpairCli();
