-- Robô de WhatsApp por dispositivo conectado (Z-API ou Evolution API): credenciais para responder.
alter table orgs
  add column if not exists wa_api_url text,
  add column if not exists wa_instance text,
  add column if not exists wa_api_token_encrypted text,
  add column if not exists wa_client_token_encrypted text;
alter table whatsapp_inbox add column if not exists reply_sent boolean;
