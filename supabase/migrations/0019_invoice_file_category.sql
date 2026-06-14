-- Add an "invoice" file category (e.g. commission invoices) before the catch-all "other".
alter type file_category add value if not exists 'invoice' before 'other';
