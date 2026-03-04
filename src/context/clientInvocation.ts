import type { ClientTarget, ReducerArgument, ReducerClientUsage, ReducerSchema } from "../types.js";

function toCamelCase(input: string): string {
  return input.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toPascalCase(input: string): string {
  const camel = toCamelCase(input);
  return camel.length > 0 ? camel[0].toUpperCase() + camel.slice(1) : camel;
}

function inferTsPlaceholder(typeName: string): string {
  if (/^u?i\d+$/i.test(typeName) || /^f\d+$/i.test(typeName)) {
    return "0";
  }

  if (typeName === "bool") {
    return "false";
  }

  if (typeName === "String" || typeName === "&str") {
    return '"value"';
  }

  if (typeName.startsWith("Option<")) {
    return "null";
  }

  if (typeName.startsWith("Vec<") || typeName.startsWith("[")) {
    return "[]";
  }

  if (typeName.includes("HashMap") || typeName.includes("BTreeMap")) {
    return "{}";
  }

  return "undefined";
}

function inferCsharpPlaceholder(typeName: string): string {
  if (/^u?i\d+$/i.test(typeName) || /^f\d+$/i.test(typeName)) {
    return "0";
  }

  if (typeName === "bool") {
    return "false";
  }

  if (typeName === "String" || typeName === "&str") {
    return '"value"';
  }

  if (typeName.startsWith("Option<")) {
    return "null";
  }

  if (typeName.startsWith("Vec<") || typeName.startsWith("[")) {
    return "new[] { }";
  }

  if (typeName.includes("HashMap") || typeName.includes("BTreeMap")) {
    return "new Dictionary<string, object>()";
  }

  return "default";
}

function buildArgumentValues(args: ReducerArgument[], client: ClientTarget): string {
  return args
    .map((arg) => {
      const placeholder =
        client === "typescript" ? inferTsPlaceholder(arg.type) : inferCsharpPlaceholder(arg.type);
      return `${arg.name}: ${placeholder}`;
    })
    .join(", ");
}

function buildTsInvocation(reducer: ReducerSchema): { invocation: string; alternatives: string[] } {
  const argList = reducer.arguments.map((arg) => arg.name).join(", ");
  const camelName = toCamelCase(reducer.name);

  return {
    invocation: `await client.reducers.${camelName}(${argList});`,
    alternatives: [
      reducer.name === camelName
        ? ""
        : `await client.reducers.${reducer.name}(${argList});`,
      `const payload = { ${buildArgumentValues(reducer.arguments, "typescript")} };`
    ].filter((entry) => entry.length > 0)
  };
}

function buildCsharpInvocation(reducer: ReducerSchema): { invocation: string; alternatives: string[] } {
  const argList = reducer.arguments.map((arg) => arg.name).join(", ");
  const pascalName = toPascalCase(reducer.name);

  return {
    invocation: `await connection.Reducers.${pascalName}(${argList});`,
    alternatives: [
      pascalName === reducer.name ? "" : `await connection.Reducers.${reducer.name}(${argList});`,
      `var payload = new { ${buildArgumentValues(reducer.arguments, "csharp")} };`
    ].filter((entry) => entry.length > 0)
  };
}

export function buildReducerClientUsage(
  reducer: ReducerSchema,
  client: ClientTarget
): ReducerClientUsage {
  const invocationData =
    client === "typescript" ? buildTsInvocation(reducer) : buildCsharpInvocation(reducer);

  return {
    reducerName: reducer.name,
    module: reducer.module,
    client,
    arguments: reducer.arguments,
    invocation: invocationData.invocation,
    alternatives: invocationData.alternatives,
    notes: [
      "Ensure reducer argument order matches generated SDK bindings.",
      "Call reducers through the generated SpacetimeDB client, not HTTP endpoints.",
      "Validate optional arguments and nullability before invoking in client code."
    ]
  };
}
