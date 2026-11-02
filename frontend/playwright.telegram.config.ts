import { defineConfig } from '@playwright/test';
import auth from './playwright.auth.config';
// A fresh database keeps this UI scenario independent of password/rate-limit tests.
export default defineConfig({ ...auth, testDir: './tests/telegram-browser' });
