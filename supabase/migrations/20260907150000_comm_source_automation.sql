-- Messages n8n sends/reads on Alex's behalf (Frances's meeting confirmations, inbound replies) are
-- logged in communications with their own source, so history shows who actually sent them.
alter type public.comm_source add value if not exists 'automation';
