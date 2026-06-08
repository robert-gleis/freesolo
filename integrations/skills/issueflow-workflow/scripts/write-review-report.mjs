#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distEntry = path.resolve(import.meta.dirname, '../../../../dist/src/reports/write-review-report.js');
const { writeReviewReportForRepo } = await import(pathToFileURL(distEntry).href);
await writeReviewReportForRepo(process.cwd());
