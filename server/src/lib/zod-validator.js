/**
 * Integración de Zod con el sistema de validación de Fastify 5.
 *
 * El contrato del compilador es devolver `{ value }` o `{ error }` — nunca
 * lanzar. Fastify convierte un throw sincrónico en statusCode 500 (ver
 * `makeValidatorFunction` en fastify/lib/validation.js), así que hay que
 * devolver el error como valor.
 */
export function zodValidatorCompiler({ schema }) {
  return function validate(data) {
    const result = schema.safeParse(data);
    if (result.success) return { value: result.data };

    const error = new Error('validación fallida');
    error.statusCode = 400;
    error.code = 'FST_ERR_VALIDATION';
    error.validation = result.error.issues.map((issue) => ({
      instancePath: issue.path.join('/'),
      params: {},
      message: issue.message,
      schemaPath: issue.code,
      keyword: issue.code,
    }));

    return { error };
  };
}