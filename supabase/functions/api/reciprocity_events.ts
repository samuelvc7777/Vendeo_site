type EventsOptions = {
  request: Request;
  authorize: (request: Request, conversationId: string) => Promise<boolean>;
  subscribe: (conversationId: string, onChange: () => void, onError: () => void) => Promise<() => void>;
  corsHeaders: Record<string, string>;
};

export async function handleReciprocityEvents({ request, authorize, subscribe, corsHeaders }: EventsOptions): Promise<Response> {
  const json = (status: number, error: string) => new Response(JSON.stringify({ error }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (request.method !== "GET") return json(405, "Método não permitido.");
  const conversationId = new URL(request.url).searchParams.get("conversationId") || "";
  if (!conversationId || conversationId.length > 256) return json(400, "Conversa inválida.");
  try {
    if (!await authorize(request, conversationId)) return json(403, "Conversa fora do escopo autorizado.");
  } catch {
    return json(401, "Acesso à análise não autorizado.");
  }

  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let stop = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      stop = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", stop);
        unsubscribe?.();
        controller.close();
      };
      const emit = (event: string) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));
      };
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) { stop(); return; }
      try {
        const cleanup = await subscribe(conversationId, () => emit("change"), () => {
          emit("unavailable");
          stop();
        });
        if (closed) cleanup();
        else { unsubscribe = cleanup; emit("ready"); }
      } catch {
        emit("unavailable");
        stop();
      }
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: {
    ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
  } });
}
