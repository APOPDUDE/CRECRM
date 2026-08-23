"""CRECRM land/parcel enrichment pipeline.

Harvests county + federal GIS layers into a local PostGIS cache and (in a
later phase) spatial-joins them to parcels, pushing derived scalars to
Supabase via import_parcel_enrichment(). See
context/land-book-parcel-enrichment.md for the architecture and the WHY.
"""

__version__ = "0.1.0"
