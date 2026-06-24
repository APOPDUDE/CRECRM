export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          building_sf_max: number | null
          building_sf_min: number | null
          cap_rate_min: number | null
          commission_pct: number | null
          company_id: string | null
          contact_id: string
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          id: string
          is_rep: boolean
          land_acres_max: number | null
          land_acres_min: number | null
          lost_reason: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action: string | null
          next_action_date: string | null
          owner_id: string
          property_type: Database["public"]["Enums"]["property_kind"] | null
          purpose: Database["public"]["Enums"]["client_purpose"] | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["client_status"]
          target_markets: string | null
          updated_at: string
        }
        Insert: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          building_sf_max?: number | null
          building_sf_min?: number | null
          cap_rate_min?: number | null
          commission_pct?: number | null
          company_id?: string | null
          contact_id: string
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          id?: string
          is_rep?: boolean
          land_acres_max?: number | null
          land_acres_min?: number | null
          lost_reason?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action?: string | null
          next_action_date?: string | null
          owner_id: string
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          purpose?: Database["public"]["Enums"]["client_purpose"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["client_status"]
          target_markets?: string | null
          updated_at?: string
        }
        Update: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          building_sf_max?: number | null
          building_sf_min?: number | null
          cap_rate_min?: number | null
          commission_pct?: number | null
          company_id?: string | null
          contact_id?: string
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          id?: string
          is_rep?: boolean
          land_acres_max?: number | null
          land_acres_min?: number | null
          lost_reason?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action?: string | null
          next_action_date?: string | null
          owner_id?: string
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          purpose?: Database["public"]["Enums"]["client_purpose"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["client_status"]
          target_markets?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_broker_contact_id_fkey"
            columns: ["broker_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          industry: string | null
          name: string
          notes: string | null
          phone: string | null
          type: Database["public"]["Enums"]["company_type"]
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          type?: Database["public"]["Enums"]["company_type"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          type?: Database["public"]["Enums"]["company_type"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      comps: {
        Row: {
          asking_lease_rate_psf: number | null
          cap_rate_pct: number | null
          as_of_date: string | null
          commission_fee: number | null
          opex_psf: number | null
          commencement_date: string | null
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          escalations: string | null
          executed_at: string | null
          executed_lease_rate_psf: number | null
          expiration_date: string | null
          free_rent_months: number | null
          id: string
          kind: Database["public"]["Enums"]["comp_kind"]
          land_acres: number | null
          lease_structure: Database["public"]["Enums"]["lease_structure"] | null
          notes: string | null
          owner_id: string | null
          price_per_acre: number | null
          price_per_sf: number | null
          property_id: string
          pursuit_id: string | null
          sale_price: number | null
          sf: number | null
          source: string
          source_key: string | null
          tenant_company_id: string | null
          term_months: number | null
          ti_psf: number | null
          updated_at: string
        }
        Insert: {
          asking_lease_rate_psf?: number | null
          cap_rate_pct?: number | null
          as_of_date?: string | null
          commission_fee?: number | null
          opex_psf?: number | null
          commencement_date?: string | null
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["comp_kind"]
          land_acres?: number | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          notes?: string | null
          owner_id?: string | null
          price_per_acre?: number | null
          price_per_sf?: number | null
          property_id: string
          pursuit_id?: string | null
          sale_price?: number | null
          sf?: number | null
          source?: string
          source_key?: string | null
          tenant_company_id?: string | null
          term_months?: number | null
          ti_psf?: number | null
          updated_at?: string
        }
        Update: {
          asking_lease_rate_psf?: number | null
          cap_rate_pct?: number | null
          as_of_date?: string | null
          commission_fee?: number | null
          opex_psf?: number | null
          commencement_date?: string | null
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["comp_kind"]
          land_acres?: number | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          notes?: string | null
          owner_id?: string | null
          price_per_acre?: number | null
          price_per_sf?: number | null
          property_id?: string
          pursuit_id?: string | null
          sale_price?: number | null
          sf?: number | null
          source?: string
          source_key?: string | null
          tenant_company_id?: string | null
          term_months?: number | null
          ti_psf?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comps_pursuit_id_fkey"
            columns: ["pursuit_id"]
            isOneToOne: false
            referencedRelation: "pursuits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comps_tenant_company_id_fkey"
            columns: ["tenant_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          notes: string | null
          phone: string
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      county_lookup: {
        Row: {
          city_key: string
          county: string
        }
        Insert: {
          city_key: string
          county: string
        }
        Update: {
          city_key?: string
          county?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          category: Database["public"]["Enums"]["file_category"]
          client_id: string | null
          contact_id: string | null
          file_name: string
          file_size: number | null
          id: string
          listing_id: string | null
          mime_type: string | null
          property_id: string | null
          pursuit_id: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id?: string | null
          contact_id?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          listing_id?: string | null
          mime_type?: string | null
          property_id?: string | null
          pursuit_id?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id?: string | null
          contact_id?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          listing_id?: string | null
          mime_type?: string | null
          property_id?: string | null
          pursuit_id?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_pursuit_id_fkey"
            columns: ["pursuit_id"]
            isOneToOne: false
            referencedRelation: "pursuits"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          actual_fee: number | null
          asking_price: number | null
          asking_rate_psf: number | null
          broker_contact_id: string | null
          co_broke_split_pct: number | null
          commission_pct: number | null
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          estimated_fee: number | null
          id: string
          landlord_company_id: string | null
          landlord_contact_id: string | null
          landlord_requirements: string | null
          lease_structure: Database["public"]["Enums"]["lease_structure"] | null
          listing_expiration: string | null
          lost_reason: string | null
          next_action_date: string | null
          next_action_description: string | null
          opex_psf: number | null
          owner_id: string
          probability_pct: number | null
          property_id: string
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["listing_stage"]
          status: Database["public"]["Enums"]["engagement_status"]
          updated_at: string
        }
        Insert: {
          actual_fee?: number | null
          asking_price?: number | null
          asking_rate_psf?: number | null
          broker_contact_id?: string | null
          co_broke_split_pct?: number | null
          commission_pct?: number | null
          created_at?: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          estimated_fee?: number | null
          id?: string
          landlord_company_id?: string | null
          landlord_contact_id?: string | null
          landlord_requirements?: string | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          listing_expiration?: string | null
          lost_reason?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
          opex_psf?: number | null
          owner_id: string
          probability_pct?: number | null
          property_id: string
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["listing_stage"]
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
        }
        Update: {
          actual_fee?: number | null
          asking_price?: number | null
          asking_rate_psf?: number | null
          broker_contact_id?: string | null
          co_broke_split_pct?: number | null
          commission_pct?: number | null
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          estimated_fee?: number | null
          id?: string
          landlord_company_id?: string | null
          landlord_contact_id?: string | null
          landlord_requirements?: string | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          listing_expiration?: string | null
          lost_reason?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
          opex_psf?: number | null
          owner_id?: string
          probability_pct?: number | null
          property_id?: string
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["listing_stage"]
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_broker_contact_id_fkey"
            columns: ["broker_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_landlord_company_id_fkey"
            columns: ["landlord_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_landlord_contact_id_fkey"
            columns: ["landlord_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_parcels: {
        Row: {
          created_at: string
          is_primary: boolean
          listing_id: string
          property_id: string
        }
        Insert: {
          created_at?: string
          is_primary?: boolean
          listing_id: string
          property_id: string
        }
        Update: {
          created_at?: string
          is_primary?: boolean
          listing_id?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_parcels_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_parcels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          id: string
          property_id: string
          label: string | null
          size_sf: number | null
          size_acres: number | null
          asking_rate_psf: number | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          property_id: string
          label?: string | null
          size_sf?: number | null
          size_acres?: number | null
          asking_rate_psf?: number | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          property_id?: string
          label?: string | null
          size_sf?: number | null
          size_acres?: number | null
          asking_rate_psf?: number | null
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      pursuit_units: {
        Row: {
          pursuit_id: string
          unit_id: string
          created_at: string
        }
        Insert: {
          pursuit_id: string
          unit_id: string
          created_at?: string
        }
        Update: {
          pursuit_id?: string
          unit_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pursuit_units_pursuit_id_fkey"
            columns: ["pursuit_id"]
            isOneToOne: false
            referencedRelation: "pursuits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pursuit_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          client_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["note_kind"]
          listing_id: string | null
          pursuit_id: string | null
        }
        Insert: {
          body: string
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["note_kind"]
          listing_id?: string | null
          pursuit_id?: string | null
        }
        Update: {
          body?: string
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["note_kind"]
          listing_id?: string | null
          pursuit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_pursuit_id_fkey"
            columns: ["pursuit_id"]
            isOneToOne: false
            referencedRelation: "pursuits"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          building_class: string | null
          building_far: string | null
          building_sf: number | null
          city: string | null
          construction_status: string | null
          county: string | null
          created_at: string
          days_on_market: number | null
          gross_leasable_area: string | null
          id: string
          is_auction: boolean | null
          land_acres: number | null
          lat: number | null
          listed_at: string | null
          listing_status: Database["public"]["Enums"]["listing_market_status"]
          last_seen_in_sweep: string | null
          owner_name: string | null
          owner_mailing_address: string | null
          just_value: number | null
          assessed_value: number | null
          dor_use_code: string | null
          appraiser_data: Json | null
          appraiser_updated_at: string | null
          listing_url: string | null
          lng: number | null
          num_units: number | null
          occupancy: string | null
          on_ground_lease: boolean | null
          opportunity_zone: boolean | null
          parcel_number: string | null
          parking_ratio: string | null
          photo_urls: string[] | null
          property_sub_types: string[] | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions: string | null
          sale_status: number | null
          sale_type: string | null
          scraped_at: string | null
          source: string | null
          source_key: string | null
          source_last_updated: string | null
          specs: string | null
          state: string | null
          stories: number | null
          title: string | null
          updated_at: string
          year_built: number | null
          year_renovated: number | null
          zip: string | null
          zoning_description: string | null
          zoning_district: string | null
        }
        Insert: {
          address: string
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_class?: string | null
          building_far?: string | null
          building_sf?: number | null
          city?: string | null
          construction_status?: string | null
          county?: string | null
          created_at?: string
          days_on_market?: number | null
          gross_leasable_area?: string | null
          id?: string
          is_auction?: boolean | null
          land_acres?: number | null
          lat?: number | null
          listed_at?: string | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          last_seen_in_sweep?: string | null
          owner_name?: string | null
          owner_mailing_address?: string | null
          just_value?: number | null
          assessed_value?: number | null
          dor_use_code?: string | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          parcel_number?: string | null
          parking_ratio?: string | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions?: string | null
          sale_status?: number | null
          sale_type?: string | null
          scraped_at?: string | null
          source?: string | null
          source_key?: string | null
          source_last_updated?: string | null
          specs?: string | null
          state?: string | null
          stories?: number | null
          title?: string | null
          updated_at?: string
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Update: {
          address?: string
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_class?: string | null
          building_far?: string | null
          building_sf?: number | null
          city?: string | null
          construction_status?: string | null
          county?: string | null
          created_at?: string
          days_on_market?: number | null
          gross_leasable_area?: string | null
          id?: string
          is_auction?: boolean | null
          land_acres?: number | null
          lat?: number | null
          listed_at?: string | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          last_seen_in_sweep?: string | null
          owner_name?: string | null
          owner_mailing_address?: string | null
          just_value?: number | null
          assessed_value?: number | null
          dor_use_code?: string | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          parcel_number?: string | null
          parking_ratio?: string | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions?: string | null
          sale_status?: number | null
          sale_type?: string | null
          scraped_at?: string | null
          source?: string | null
          source_key?: string | null
          source_last_updated?: string | null
          specs?: string | null
          state?: string | null
          stories?: number | null
          title?: string | null
          updated_at?: string
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Relationships: []
      }
      pursuits: {
        Row: {
          actual_fee: number | null
          client_id: string
          created_at: string
          executed_date: string | null
          flagged_new: boolean
          id: string
          inquiry_date: string
          notes: string | null
          owner_id: string
          payment_received: boolean
          property_id: string
          stage: Database["public"]["Enums"]["pursuit_stage"]
          tour_date: string | null
          tour_time: string | null
          updated_at: string
        }
        Insert: {
          actual_fee?: number | null
          client_id: string
          created_at?: string
          executed_date?: string | null
          flagged_new?: boolean
          id?: string
          inquiry_date?: string
          notes?: string | null
          owner_id: string
          payment_received?: boolean
          property_id: string
          stage?: Database["public"]["Enums"]["pursuit_stage"]
          tour_date?: string | null
          tour_time?: string | null
          updated_at?: string
        }
        Update: {
          actual_fee?: number | null
          client_id?: string
          created_at?: string
          executed_date?: string | null
          flagged_new?: boolean
          id?: string
          inquiry_date?: string
          notes?: string | null
          owner_id?: string
          payment_received?: boolean
          property_id?: string
          stage?: Database["public"]["Enums"]["pursuit_stage"]
          tour_date?: string | null
          tour_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pursuits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pursuits_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          client_id: string
          created_at: string
          id: string
          property_id: string
          status: Database["public"]["Enums"]["suggestion_status"]
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          property_id: string
          status?: Database["public"]["Enums"]["suggestion_status"]
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          property_id?: string
          status?: Database["public"]["Enums"]["suggestion_status"]
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          auto_generated: boolean
          client_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          details: string | null
          due_at: string | null
          due_date: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          listing_id: string | null
          note_id: string | null
          owner_id: string
          pursuit_id: string | null
          source: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          client_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_at?: string | null
          due_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_id?: string | null
          note_id?: string | null
          owner_id: string
          pursuit_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          client_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_at?: string | null
          due_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_id?: string | null
          note_id?: string | null
          owner_id?: string
          pursuit_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_pursuit_id_fkey"
            columns: ["pursuit_id"]
            isOneToOne: false
            referencedRelation: "pursuits"
            referencedColumns: ["id"]
          },
        ]
      }
      sweep_meta: {
        Row: {
          id: boolean
          last_run_at: string | null
          last_seen_count: number | null
        }
        Insert: {
          id?: boolean
          last_run_at?: string | null
          last_seen_count?: number | null
        }
        Update: {
          id?: boolean
          last_run_at?: string | null
          last_seen_count?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      v_county_market_stats: {
        Row: {
          county: string | null
          property_type: string | null
          lease_n: number | null
          lease_avg_psf: number | null
          lease_median_psf: number | null
          lease_p25_psf: number | null
          lease_p75_psf: number | null
          sale_n: number | null
          sale_avg_psf: number | null
          sale_median_psf: number | null
          sale_p25_psf: number | null
          sale_p75_psf: number | null
          sale_avg_cap: number | null
          sale_cap_n: number | null
          land_n: number | null
          land_avg_per_acre: number | null
          land_median_per_acre: number | null
          listing_n: number | null
          avg_dom: number | null
        }
        Relationships: []
      }
      v_property_market_position: {
        Row: {
          id: string | null
          county: string | null
          property_type: string | null
          asking_rate_psf: number | null
          lease_baseline_median: number | null
          lease_baseline_n: number | null
          lease_vs_market_pct: number | null
          good_lease_deal: boolean | null
          sale_psf: number | null
          sale_baseline_median: number | null
          sale_baseline_n: number | null
          sale_vs_market_pct: number | null
          good_sale_deal: boolean | null
          land_per_acre: number | null
          land_baseline_median: number | null
          land_baseline_n: number | null
          land_vs_market_pct: number | null
          good_land_deal: boolean | null
        }
        Relationships: []
      }
      v_property_current_asking: {
        Row: {
          property_id: string | null
          deal_type: Database["public"]["Enums"]["deal_type"] | null
          asking_lease_rate_psf: number | null
          sale_price: number | null
          cap_rate_pct: number | null
          sf: number | null
          as_of_date: string | null
          comp_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_parcel_to_listing: {
        Args: {
          p_listing_id: string
          p_property_id: string
          p_is_primary?: boolean
        }
        Returns: Database["public"]["Tables"]["listing_parcels"]["Row"]
      }
      approve_suggestion: {
        Args: { p_suggestion_id: string; p_client_id?: string | null }
        Returns: string
      }
      create_property_and_listing: {
        Args: {
          p_address: string
          p_asking_price?: number
          p_asking_rate_psf?: number
          p_city?: string
          p_deal_type: Database["public"]["Enums"]["deal_type"]
          p_landlord_company_id?: string
          p_landlord_contact_id?: string
          p_owner: string
          p_property_type?: Database["public"]["Enums"]["property_kind"]
          p_source?: Database["public"]["Enums"]["lead_source"]
          p_state?: string
        }
        Returns: Database["public"]["Tables"]["listings"]["Row"]
      }
      cross_reference: { Args: { p_property_ids: string[] }; Returns: Json }
      ensure_payment_checks: { Args: Record<PropertyKey, never>; Returns: Json }
      execute_pursuit: {
        Args: { p?: Json; p_pursuit_id: string }
        Returns: Json
      }
      import_scraped_listings: {
        Args: { p_client_id?: string; p_flagged_new?: boolean; p_props: Json }
        Returns: Json
      }
      intake_client: { Args: { p: Json; p_owner: string }; Returns: Json }
      intake_landlord_listing: {
        Args: { p: Json; p_owner: string }
        Returns: Json
      }
      promote_client: {
        Args: { p_client_id: string }
        Returns: Database["public"]["Tables"]["clients"]["Row"]
      }
      sweep_mark_off_market: {
        Args: { p_seen_property_ids: string[] }
        Returns: Json
      }
    }
    Enums: {
      client_purpose:
        | "expansion"
        | "first_location"
        | "relocation"
        | "investment"
      client_status: "prospect" | "searching" | "negotiating" | "closed" | "lost"
      comp_kind: "asking" | "executed"
      company_type: "landlord" | "tenant" | "broker" | "other" | "vendor"
      deal_type: "lease" | "sale" | "both"
      engagement_status: "active" | "lost"
      file_category:
        | "listing_agreement"
        | "rep_agreement"
        | "marketing"
        | "loi"
        | "lease"
        | "psa"
        | "coi_insurance"
        | "guarantee"
        | "financials"
        | "invoice"
        | "other"
      lead_source:
        | "loopnet"
        | "sign_call"
        | "cold_call"
        | "email"
        | "text"
        | "website"
        | "referral"
        | "broker"
      lease_structure: "NNN" | "NN" | "MG"
      listing_market_status: "on_market" | "off_market"
      listing_stage: "proposal" | "listed" | "closed"
      note_kind: "note" | "call" | "text" | "email" | "meeting"
      property_kind: "industrial" | "office" | "retail" | "land" | "other"
      pursuit_stage:
        | "inquiring"
        | "touring"
        | "negotiation"
        | "executed"
        | "passed"
      suggestion_status: "pending" | "dismissed"
      task_kind: "renewal" | "follow_up" | "general" | "tour"
      task_status: "open" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      client_purpose: [
        "expansion",
        "first_location",
        "relocation",
        "investment",
      ],
      client_status: ["prospect", "searching", "negotiating", "closed", "lost"],
      comp_kind: ["asking", "executed"],
      company_type: ["landlord", "tenant", "broker", "other", "vendor"],
      deal_type: ["lease", "sale", "both"],
      engagement_status: ["active", "lost"],
      file_category: [
        "listing_agreement",
        "rep_agreement",
        "marketing",
        "loi",
        "lease",
        "psa",
        "coi_insurance",
        "guarantee",
        "financials",
        "invoice",
        "other",
      ],
      lead_source: [
        "loopnet",
        "sign_call",
        "cold_call",
        "email",
        "text",
        "website",
        "referral",
        "broker",
      ],
      lease_structure: ["NNN", "NN", "MG"],
      listing_market_status: ["on_market", "off_market"],
      listing_stage: ["proposal", "listed", "closed"],
      note_kind: ["note", "call", "text", "email", "meeting"],
      property_kind: ["industrial", "office", "retail", "land", "other"],
      pursuit_stage: [
        "inquiring",
        "touring",
        "negotiation",
        "executed",
        "passed",
      ],
      suggestion_status: ["pending", "dismissed"],
      task_kind: ["renewal", "follow_up", "general", "tour"],
      task_status: ["open", "done"],
    },
  },
} as const
