export const PYTHON_BIN_ENV = 'PULSO_PYTHON_BIN';

export function pythonExecutable() {
  return String(process.env[PYTHON_BIN_ENV] || 'python').trim() || 'python';
}
