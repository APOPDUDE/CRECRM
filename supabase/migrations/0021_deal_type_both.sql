-- Allow a listing or tenant rep to be both lease and sale (e.g. landlord open to either,
-- or a tenant looking to lease or buy).
alter type deal_type add value if not exists 'both';
