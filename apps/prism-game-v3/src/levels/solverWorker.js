import { solveLevel } from './solver.js';

self.onmessage = (event) => {
  const { requestId, level, options } = event.data;
  try {
    const result = solveLevel(level, options);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: { name: error.name, message: error.message, validationErrors: error.validationErrors ?? null }
    });
  }
};
