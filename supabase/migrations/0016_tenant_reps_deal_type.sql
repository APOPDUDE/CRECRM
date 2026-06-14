-- Tenant reps can represent a tenant looking to LEASE (default) or to BUY (sale).
-- Mirrors listings.deal_type so the tenant board can relabel stages for purchase
-- deals (Offer / PSA negotiation / PSA executed) the same way the property board does.
alter table tenant_reps
  add column deal_type deal_type not null default 'lease';

comment on column tenant_reps.deal_type is
  'lease = tenant seeking space to lease; sale = user-buyer seeking space to purchase';
