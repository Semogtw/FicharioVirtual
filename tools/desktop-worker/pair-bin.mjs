#!/usr/bin/env node

import process from 'node:process';
import { runPairCli } from './pair-command.mjs';

process.exitCode = await runPairCli();
