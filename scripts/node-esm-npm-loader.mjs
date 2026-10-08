export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("npm:")) {
    // Transforma "npm:openai@7.23.0" -> "openai" ou "npm:@openai/agents@0.18.0" -> "@openai/agents"
    const withoutPrefix = specifier.slice(4);
    let pkgName = withoutPrefix;
    if (withoutPrefix.startsWith("@")) {
      const parts = withoutPrefix.split("/");
      const scope = parts[0];
      const rest = parts.slice(1).join("/");
      const nameWithoutVersion = rest.replace(/@[^/]+$/, "");
      pkgName = `${scope}/${nameWithoutVersion}`;
    } else {
      pkgName = withoutPrefix.replace(/@[^/]+$/, "");
    }
    try {
      return await nextResolve(pkgName, context);
    } catch {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default { setVapidDetails: () => {}, sendNotification: async () => ({}) }; export const setVapidDetails = () => {}; export const sendNotification = async () => ({}); export class OpenAI {}",
      };
    }
  }
  return nextResolve(specifier, context);
}
