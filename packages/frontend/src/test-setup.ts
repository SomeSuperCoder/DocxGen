import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Autosave keeps the draft in localStorage — start every test with an empty editor
afterEach(() => localStorage.clear());
