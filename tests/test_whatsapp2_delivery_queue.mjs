import test from "node:test";
import assert from "node:assert/strict";

import { enqueueAndWaitWhatsApp2Delivery } from "../supabase/functions/api/whatsapp2_gateway.ts";

test("fila persiste o nome e o pedido de salvar contato sem confundir isso com o resultado da mensagem", async () => {
  let insertedDelivery = null;
  const supabase = {
    from(table) {
      assert.equal(table, "whatsapp2_delivery_queue");
      return {
        select: () => ({
          eq: (_field, id) => ({
            maybeSingle: async () => ({
              data: insertedDelivery?.id === id
                ? {
                    status: "sent",
                    provider_message_id: "wam_saved_001",
                    recipient_contact_save_status: "saved",
                    recipient_contact_save_error: null,
                  }
                : null,
              error: null,
            }),
          }),
        }),
        insert: async (row) => {
          insertedDelivery = row;
          return { error: null };
        },
      };
    },
  };

  const result = await enqueueAndWaitWhatsApp2Delivery({
    supabase,
    queueId: "transfer:tinder:001:+5511977776666",
    conversationId: "tinder:001",
    recipientId: "+5511977776666",
    kind: "text",
    text: "Oi, sou eu do Tinder.",
    saveRecipientContact: true,
    recipientContactName: "Amanda Souza",
  });

  assert.equal(insertedDelivery.recipient_id, "+5511977776666");
  assert.equal(insertedDelivery.save_recipient_contact, true);
  assert.equal(insertedDelivery.recipient_contact_name, "Amanda Souza");
  assert.equal(insertedDelivery.recipient_contact_save_status, "pending");
  assert.equal(result.success, true);
  assert.equal(result.providerMessageId, "wam_saved_001");
  assert.equal(result.contactSaveStatus, "saved");
});
