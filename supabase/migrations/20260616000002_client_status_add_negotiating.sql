-- Add 'negotiating' between (active/searching) and closed. Must be its own committed
-- migration so the new value can be used by later statements/migrations.
alter type client_status add value if not exists 'negotiating' before 'closed';
