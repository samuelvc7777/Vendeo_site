const TABLE = "tinder_conversation_schedules";
const BASE = "/match/tinder/schedules";

function invalid(message: string): never {
  throw Object.assign(new Error(message), {
    status: 400,
    code: "TINDER_SCHEDULE_INVALID",
  });
}

/** Whitelist do contrato textual; nenhum campo de mídia ou memória é persistido. */
export function validateTinderSchedule(input: any) {
  const text = (value: unknown, name: string, max: number, required = true) => {
    if (
      typeof value !== "string" ||
      value.trim().length > max ||
      (required && !value.trim())
    ) {
      invalid(`${name} inválido.`);
    }
    return String(value).trim();
  };
  if (!input || typeof input !== "object") invalid("Cronograma inválido.");
  const name = text(input.name, "Nome do cronograma", 120);
  const description = text(input.description ?? "", "Descrição", 2000, false);
  const stageName = text(input.stageName, "Nome da etapa", 120);
  const prompt = text(input.prompt, "Prompt", 12000);
  if (!["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"].includes(input.brainModel))
    invalid("Modelo inválido.");
  if (typeof input.isActive !== "boolean")
    invalid("Estado do cronograma inválido.");
  if (
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 100
  )
    invalid("Configure de 1 a 100 mensagens.");
  const ids = new Set<string>();
  const messages = input.messages.map((item: any) => {
    const id = text(item?.id, "Identificador da mensagem", 80);
    if (ids.has(id)) invalid("Identificadores de mensagem repetidos.");
    ids.add(id);
    return { id, text: text(item?.text, "Texto da mensagem", 4000) };
  });
  const delay = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
      invalid("Tempo de resposta inválido.");
    return Number(value);
  };
  if (!["fixed", "range"].includes(input.responseDelayMode))
    invalid("Modo de tempo inválido.");
  const fixed =
    input.responseDelayMode === "fixed"
      ? delay(input.responseDelayFixedSeconds)
      : null;
  const min =
    input.responseDelayMode === "range"
      ? delay(input.responseDelayMinSeconds)
      : null;
  const max =
    input.responseDelayMode === "range"
      ? delay(input.responseDelayMaxSeconds)
      : null;
  if (min != null && max != null && min > max)
    invalid("O tempo mínimo não pode superar o máximo.");
  return {
    name,
    description,
    stageName,
    prompt,
    messages,
    isActive: input.isActive,
    brainModel: input.brainModel,
    responseDelayMode: input.responseDelayMode,
    responseDelayFixedSeconds: fixed,
    responseDelayMinSeconds: min,
    responseDelayMaxSeconds: max,
  };
}

function project(row: any) {
  return {
    ...row.config,
    id: row.id,
    order: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function handleTinderScheduleRoutes(params: {
  request: Request;
  path: string;
  supabase: any;
  corsHeaders: Record<string, string>;
  accountId: string;
}): Promise<Response> {
  const { request, path, supabase, corsHeaders, accountId } = params;
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (!accountId)
    return json(
      {
        success: false,
        error: "Reconecte a conta Tinder para configurar os cronogramas.",
      },
      401,
    );
  const list = async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("account_id", accountId)
      .order("position")
      .order("created_at");
    if (error) throw error;
    return data || [];
  };
  if (path === BASE && request.method === "GET") {
    return json({ success: true, schedules: (await list()).map(project) });
  }
  if (path === BASE && request.method === "POST") {
    const config = validateTinderSchedule(
      await request.json().catch(() => null),
    );
    const rows = await list();
    const position =
      rows.reduce((max: number, row: any) => Math.max(max, row.position), -1) +
      1;
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ account_id: accountId, config, position })
      .select()
      .single();
    if (error) throw error;
    return json({ success: true, schedule: project(data) }, 201);
  }
  if (path === BASE && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    const ids = body?.scheduleIds;
    const rows = await list();
    if (
      !Array.isArray(ids) ||
      ids.length !== rows.length ||
      new Set(ids).size !== ids.length ||
      rows.some((row: any) => !ids.includes(row.id))
    ) {
      invalid("A lista de cronogramas mudou. Atualize antes de reordenar.");
    }
    if (rows.length) {
      const { error } = await supabase
        .from(TABLE)
        .upsert(
          rows.map((row: any) => ({
            ...row,
            position: ids.indexOf(row.id),
            updated_at: new Date().toISOString(),
          })),
        );
      if (error) throw error;
    }
    return json({ success: true });
  }
  const id = path.slice(BASE.length + 1);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return json({ success: false, error: "Cronograma não encontrado." }, 404);
  }
  if (request.method === "PUT" || request.method === "DELETE") {
    let query;
    if (request.method === "PUT") {
      const config = validateTinderSchedule(
        await request.json().catch(() => null),
      );
      query = supabase
        .from(TABLE)
        .update({ config, updated_at: new Date().toISOString() });
    } else query = supabase.from(TABLE).delete();
    const { data, error } = await query
      .eq("id", id)
      .eq("account_id", accountId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return json({ success: false, error: "Cronograma não encontrado." }, 404);
    return json({
      success: true,
      ...(request.method === "PUT" ? { schedule: project(data) } : {}),
    });
  }
  return json({ success: false, error: "Operação não permitida." }, 405);
}
