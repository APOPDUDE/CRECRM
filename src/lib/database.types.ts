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
      _rollback_replay_20260708: {
        Row: {
          address: string | null
          appraiser_data: Json | null
          appraiser_updated_at: string | null
          assessed_value: number | null
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
          created_at: string | null
          days_on_market: number | null
          dor_use_code: string | null
          gross_leasable_area: string | null
          id: string | null
          is_auction: boolean | null
          just_value: number | null
          land_acres: number | null
          last_seen_in_sweep: string | null
          lat: number | null
          listed_at: string | null
          listing_status:
            | Database["public"]["Enums"]["listing_market_status"]
            | null
          listing_url: string | null
          lng: number | null
          num_units: number | null
          occupancy: string | null
          on_ground_lease: boolean | null
          opportunity_zone: boolean | null
          owner_mailing_address: string | null
          owner_name: string | null
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
          updated_at: string | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
          zoning_description: string | null
          zoning_district: string | null
        }
        Insert: {
          address?: string | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
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
          created_at?: string | null
          days_on_market?: number | null
          dor_use_code?: string | null
          gross_leasable_area?: string | null
          id?: string | null
          is_auction?: boolean | null
          just_value?: number | null
          land_acres?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listed_at?: string | null
          listing_status?:
            | Database["public"]["Enums"]["listing_market_status"]
            | null
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_mailing_address?: string | null
          owner_name?: string | null
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
          updated_at?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Update: {
          address?: string | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
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
          created_at?: string | null
          days_on_market?: number | null
          dor_use_code?: string | null
          gross_leasable_area?: string | null
          id?: string | null
          is_auction?: boolean | null
          just_value?: number | null
          land_acres?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listed_at?: string | null
          listing_status?:
            | Database["public"]["Enums"]["listing_market_status"]
            | null
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_mailing_address?: string | null
          owner_name?: string | null
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
          updated_at?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          building_sf_max: number | null
          building_sf_min: number | null
          buyer_kind: Database["public"]["Enums"]["buyer_kind"] | null
          cap_rate_min: number | null
          commission_pct: number | null
          company_id: string | null
          contact_id: string
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          exchange_1031: boolean
          exchange_deadline: string | null
          id: string
          intended_use: string | null
          is_rep: boolean
          land_acres_max: number | null
          land_acres_min: number | null
          lost_reason: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action: string | null
          next_action_date: string | null
          owner_id: string
          price_max: number | null
          price_min: number | null
          product_subclasses: Database["public"]["Enums"]["industrial_subclass"][]
          property_type: Database["public"]["Enums"]["property_kind"] | null
          purpose: Database["public"]["Enums"]["client_purpose"] | null
          rent_budget_max: number | null
          rent_budget_min: number | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["client_status"]
          strategies: Database["public"]["Enums"]["investment_strategy"][]
          target_areas: Json
          target_markets: string | null
          updated_at: string
        }
        Insert: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          building_sf_max?: number | null
          building_sf_min?: number | null
          buyer_kind?: Database["public"]["Enums"]["buyer_kind"] | null
          cap_rate_min?: number | null
          commission_pct?: number | null
          company_id?: string | null
          contact_id: string
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          exchange_1031?: boolean
          exchange_deadline?: string | null
          id?: string
          intended_use?: string | null
          is_rep?: boolean
          land_acres_max?: number | null
          land_acres_min?: number | null
          lost_reason?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action?: string | null
          next_action_date?: string | null
          owner_id: string
          price_max?: number | null
          price_min?: number | null
          product_subclasses?: Database["public"]["Enums"]["industrial_subclass"][]
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          purpose?: Database["public"]["Enums"]["client_purpose"] | null
          rent_budget_max?: number | null
          rent_budget_min?: number | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["client_status"]
          strategies?: Database["public"]["Enums"]["investment_strategy"][]
          target_areas?: Json
          target_markets?: string | null
          updated_at?: string
        }
        Update: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          building_sf_max?: number | null
          building_sf_min?: number | null
          buyer_kind?: Database["public"]["Enums"]["buyer_kind"] | null
          cap_rate_min?: number | null
          commission_pct?: number | null
          company_id?: string | null
          contact_id?: string
          created_at?: string
          deal_type?: Database["public"]["Enums"]["deal_type"]
          exchange_1031?: boolean
          exchange_deadline?: string | null
          id?: string
          intended_use?: string | null
          is_rep?: boolean
          land_acres_max?: number | null
          land_acres_min?: number | null
          lost_reason?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action?: string | null
          next_action_date?: string | null
          owner_id?: string
          price_max?: number | null
          price_min?: number | null
          product_subclasses?: Database["public"]["Enums"]["industrial_subclass"][]
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          purpose?: Database["public"]["Enums"]["client_purpose"] | null
          rent_budget_max?: number | null
          rent_budget_min?: number | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["client_status"]
          strategies?: Database["public"]["Enums"]["investment_strategy"][]
          target_areas?: Json
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
      communications: {
        Row: {
          body: string | null
          channel: Database["public"]["Enums"]["comm_channel"]
          contact_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["comm_direction"]
          disposition: string | null
          external_id: string | null
          id: string
          occurred_at: string
          owner_id: string | null
          phone: string | null
          property_id: string | null
          raw: Json | null
          recording_bytes: number | null
          recording_error: string | null
          recording_path: string | null
          recording_synced_at: string | null
          source: Database["public"]["Enums"]["comm_source"]
          subject: string | null
          tags: string[] | null
          transcript: string | null
        }
        Insert: {
          body?: string | null
          channel: Database["public"]["Enums"]["comm_channel"]
          contact_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["comm_direction"]
          disposition?: string | null
          external_id?: string | null
          id?: string
          occurred_at: string
          owner_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          recording_bytes?: number | null
          recording_error?: string | null
          recording_path?: string | null
          recording_synced_at?: string | null
          source: Database["public"]["Enums"]["comm_source"]
          subject?: string | null
          tags?: string[] | null
          transcript?: string | null
        }
        Update: {
          body?: string | null
          channel?: Database["public"]["Enums"]["comm_channel"]
          contact_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["comm_direction"]
          disposition?: string | null
          external_id?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          recording_bytes?: number | null
          recording_error?: string | null
          recording_path?: string | null
          recording_synced_at?: string | null
          source?: Database["public"]["Enums"]["comm_source"]
          subject?: string | null
          tags?: string[] | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      companies: {
        Row: {
          annual_revenue: number | null
          created_at: string
          employee_count: number | null
          id: string
          industry: string | null
          naics: string | null
          name: string
          notes: string | null
          phone: string | null
          sic: string | null
          source: string | null
          type: Database["public"]["Enums"]["company_type"]
          updated_at: string
          website: string | null
        }
        Insert: {
          annual_revenue?: number | null
          created_at?: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          naics?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          sic?: string | null
          source?: string | null
          type?: Database["public"]["Enums"]["company_type"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          annual_revenue?: number | null
          created_at?: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          naics?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          sic?: string | null
          source?: string | null
          type?: Database["public"]["Enums"]["company_type"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      comps: {
        Row: {
          as_of_date: string | null
          asking_lease_rate_psf: number | null
          cap_rate_pct: number | null
          commencement_date: string | null
          commission_fee: number | null
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
          opex_psf: number | null
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
          tenant_name: string | null
          term_months: number | null
          ti_psf: number | null
          unit: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          as_of_date?: string | null
          asking_lease_rate_psf?: number | null
          cap_rate_pct?: number | null
          commencement_date?: string | null
          commission_fee?: number | null
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
          opex_psf?: number | null
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
          tenant_name?: string | null
          term_months?: number | null
          ti_psf?: number | null
          unit?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          as_of_date?: string | null
          asking_lease_rate_psf?: number | null
          cap_rate_pct?: number | null
          commencement_date?: string | null
          commission_fee?: number | null
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
          opex_psf?: number | null
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
          tenant_name?: string | null
          term_months?: number | null
          ti_psf?: number | null
          unit?: string | null
          updated_at?: string
          verified?: boolean
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
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
          archived: boolean
          archived_at: string | null
          archived_reason: string | null
          campaign_lists: string[] | null
          company_id: string | null
          created_at: string
          decision_maker: Database["public"]["Enums"]["decision_maker_status"]
          do_not_call: boolean
          email: string | null
          email_verified_at: string | null
          first_name: string
          hubspot_id: string | null
          id: string
          import_addresses: string[] | null
          last_contacted_at: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          phone_grade: string | null
          phone_type: string | null
          source_system: string | null
          terrakotta_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          campaign_lists?: string[] | null
          company_id?: string | null
          created_at?: string
          decision_maker?: Database["public"]["Enums"]["decision_maker_status"]
          do_not_call?: boolean
          email?: string | null
          email_verified_at?: string | null
          first_name: string
          hubspot_id?: string | null
          id?: string
          import_addresses?: string[] | null
          last_contacted_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_grade?: string | null
          phone_type?: string | null
          source_system?: string | null
          terrakotta_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          campaign_lists?: string[] | null
          company_id?: string | null
          created_at?: string
          decision_maker?: Database["public"]["Enums"]["decision_maker_status"]
          do_not_call?: boolean
          email?: string | null
          email_verified_at?: string | null
          first_name?: string
          hubspot_id?: string | null
          id?: string
          import_addresses?: string[] | null
          last_contacted_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_grade?: string | null
          phone_type?: string | null
          source_system?: string | null
          terrakotta_id?: string | null
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
      deal_flags: {
        Row: {
          created_at: string
          id: string
          land_vs_market_pct: number | null
          lease_vs_market_pct: number | null
          property_id: string
          sale_vs_market_pct: number | null
          status: Database["public"]["Enums"]["deal_flag_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          land_vs_market_pct?: number | null
          lease_vs_market_pct?: number | null
          property_id: string
          sale_vs_market_pct?: number | null
          status?: Database["public"]["Enums"]["deal_flag_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          land_vs_market_pct?: number | null
          lease_vs_market_pct?: number | null
          property_id?: string
          sale_vs_market_pct?: number | null
          status?: Database["public"]["Enums"]["deal_flag_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_flags_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_flags_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_flags_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
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
            foreignKeyName: "files_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
          {
            foreignKeyName: "listing_parcels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_parcels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
          {
            foreignKeyName: "listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      news_items: {
        Row: {
          created_at: string
          feed_url: string | null
          id: string
          keywords: string[] | null
          published_at: string | null
          source: string | null
          title: string
          url: string
        }
        Insert: {
          created_at?: string
          feed_url?: string | null
          id?: string
          keywords?: string[] | null
          published_at?: string | null
          source?: string | null
          title: string
          url: string
        }
        Update: {
          created_at?: string
          feed_url?: string | null
          id?: string
          keywords?: string[] | null
          published_at?: string | null
          source?: string | null
          title?: string
          url?: string
        }
        Relationships: []
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
          property_id: string | null
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
          property_id?: string | null
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
          property_id?: string | null
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
            foreignKeyName: "notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
      owner_contacts: {
        Row: {
          confidence: Database["public"]["Enums"]["owner_contact_confidence"]
          contact_id: string
          created_at: string
          id: string
          match_basis: string | null
          notes: string | null
          owner_id: string
          role: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["owner_contact_confidence"]
          contact_id: string
          created_at?: string
          id?: string
          match_basis?: string | null
          notes?: string | null
          owner_id: string
          role?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          confidence?: Database["public"]["Enums"]["owner_contact_confidence"]
          contact_id?: string
          created_at?: string
          id?: string
          match_basis?: string | null
          notes?: string | null
          owner_id?: string
          role?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          created_at: string
          display_name: string
          id: string
          kind: Database["public"]["Enums"]["owner_kind"]
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          normalized_name: string | null
          notes: string | null
          tags: string[] | null
          updated_at: string
          verification_note: string | null
          verification_status: Database["public"]["Enums"]["owner_verification_status"]
          verification_updated_at: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          kind?: Database["public"]["Enums"]["owner_kind"]
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          normalized_name?: string | null
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["owner_verification_status"]
          verification_updated_at?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          kind?: Database["public"]["Enums"]["owner_kind"]
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          normalized_name?: string | null
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["owner_verification_status"]
          verification_updated_at?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string
          amps: number | null
          appraiser_data: Json | null
          appraiser_updated_at: string | null
          assessed_value: number | null
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          building_class: string | null
          building_far: string | null
          building_sf: number | null
          city: string | null
          clear_height_ft: number | null
          column_spacing: string | null
          construction_material: string | null
          construction_status: string | null
          county: string | null
          created_at: string
          cross_docks: boolean | null
          days_on_market: number | null
          description: string | null
          dock_high_doors: number | null
          dock_levelers: number | null
          dor_use_code: string | null
          grade_level_doors: number | null
          gross_leasable_area: string | null
          id: string
          is_auction: boolean | null
          just_value: number | null
          land_acres: number | null
          last_sale_date: string | null
          last_sale_price: number | null
          last_seen_in_sweep: string | null
          lat: number | null
          listed_at: string | null
          listing_status: Database["public"]["Enums"]["listing_market_status"]
          listing_url: string | null
          lng: number | null
          num_units: number | null
          occupancy: string | null
          on_ground_lease: boolean | null
          opportunity_zone: boolean | null
          owner_id: string | null
          owner_mailing_address: string | null
          owner_name: string | null
          parcel_number: string | null
          parking_ratio: string | null
          parking_spaces: number | null
          photo_urls: string[] | null
          property_sub_types: string[] | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions: string | null
          sale_status: number | null
          sale_type: string | null
          scrape_facts: Json | null
          scraped_at: string | null
          source: string | null
          source_key: string | null
          source_last_updated: string | null
          specs: string | null
          sprinkler_system: string | null
          state: string | null
          stories: number | null
          three_phase_power: boolean | null
          title: string | null
          truck_court_ft: number | null
          updated_at: string
          usable_acres: number | null
          volts: string | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
          zoning_description: string | null
          zoning_district: string | null
        }
        Insert: {
          address: string
          amps?: number | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_class?: string | null
          building_far?: string | null
          building_sf?: number | null
          city?: string | null
          clear_height_ft?: number | null
          column_spacing?: string | null
          construction_material?: string | null
          construction_status?: string | null
          county?: string | null
          created_at?: string
          cross_docks?: boolean | null
          days_on_market?: number | null
          description?: string | null
          dock_high_doors?: number | null
          dock_levelers?: number | null
          dor_use_code?: string | null
          grade_level_doors?: number | null
          gross_leasable_area?: string | null
          id?: string
          is_auction?: boolean | null
          just_value?: number | null
          land_acres?: number | null
          last_sale_date?: string | null
          last_sale_price?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listed_at?: string | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_id?: string | null
          owner_mailing_address?: string | null
          owner_name?: string | null
          parcel_number?: string | null
          parking_ratio?: string | null
          parking_spaces?: number | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions?: string | null
          sale_status?: number | null
          sale_type?: string | null
          scrape_facts?: Json | null
          scraped_at?: string | null
          source?: string | null
          source_key?: string | null
          source_last_updated?: string | null
          specs?: string | null
          sprinkler_system?: string | null
          state?: string | null
          stories?: number | null
          three_phase_power?: boolean | null
          title?: string | null
          truck_court_ft?: number | null
          updated_at?: string
          usable_acres?: number | null
          volts?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Update: {
          address?: string
          amps?: number | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_class?: string | null
          building_far?: string | null
          building_sf?: number | null
          city?: string | null
          clear_height_ft?: number | null
          column_spacing?: string | null
          construction_material?: string | null
          construction_status?: string | null
          county?: string | null
          created_at?: string
          cross_docks?: boolean | null
          days_on_market?: number | null
          description?: string | null
          dock_high_doors?: number | null
          dock_levelers?: number | null
          dor_use_code?: string | null
          grade_level_doors?: number | null
          gross_leasable_area?: string | null
          id?: string
          is_auction?: boolean | null
          just_value?: number | null
          land_acres?: number | null
          last_sale_date?: string | null
          last_sale_price?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listed_at?: string | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          listing_url?: string | null
          lng?: number | null
          num_units?: number | null
          occupancy?: string | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_id?: string | null
          owner_mailing_address?: string | null
          owner_name?: string | null
          parcel_number?: string | null
          parking_ratio?: string | null
          parking_spaces?: number | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          sale_conditions?: string | null
          sale_status?: number | null
          sale_type?: string | null
          scrape_facts?: Json | null
          scraped_at?: string | null
          source?: string | null
          source_key?: string | null
          source_last_updated?: string | null
          specs?: string | null
          sprinkler_system?: string | null
          state?: string | null
          stories?: number | null
          three_phase_power?: boolean | null
          title?: string | null
          truck_court_ft?: number | null
          updated_at?: string
          usable_acres?: number | null
          volts?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_properties: {
        Row: {
          created_at: string
          property_id: string
          prospect_id: string
        }
        Insert: {
          created_at?: string
          property_id: string
          prospect_id: string
        }
        Update: {
          created_at?: string
          property_id?: string
          prospect_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "prospect_properties_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          company_id: string | null
          contact_id: string | null
          converted_at: string | null
          converted_to: string | null
          created_at: string
          description: string | null
          details: Json | null
          id: string
          lead_type: string | null
          owner_id: string
          sourced_by: string | null
          status: Database["public"]["Enums"]["prospect_status"]
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          converted_at?: string | null
          converted_to?: string | null
          created_at?: string
          description?: string | null
          details?: Json | null
          id?: string
          lead_type?: string | null
          owner_id: string
          sourced_by?: string | null
          status?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          converted_at?: string | null
          converted_to?: string | null
          created_at?: string
          description?: string | null
          details?: Json | null
          id?: string
          lead_type?: string | null
          owner_id?: string
          sourced_by?: string | null
          status?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      pursuit_units: {
        Row: {
          created_at: string
          pursuit_id: string
          unit_id: string
        }
        Insert: {
          created_at?: string
          pursuit_id: string
          unit_id: string
        }
        Update: {
          created_at?: string
          pursuit_id?: string
          unit_id?: string
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
          {
            foreignKeyName: "pursuit_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_specs"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      pursuits: {
        Row: {
          actual_fee: number | null
          client_id: string
          closing_days: number | null
          created_at: string
          dd_days: number | null
          dd_expiration_date: string | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          earnest_deposit: number | null
          escalation_pct: number | null
          executed_date: string | null
          flagged_new: boolean
          free_rent_months: number | null
          id: string
          inquiry_date: string
          lease_term_months: number | null
          notes: string | null
          owner_id: string
          payment_received: boolean
          property_id: string
          proposed_commencement: string | null
          proposed_lease_structure:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          proposed_opex_psf: number | null
          proposed_price: number | null
          proposed_rate_psf: number | null
          proposed_sf: number | null
          renewal_terms: string | null
          security_deposit: number | null
          sort_order: number
          special_provisions: string | null
          stage: Database["public"]["Enums"]["pursuit_stage"]
          ti_allowance_psf: number | null
          tour_date: string | null
          tour_time: string | null
          updated_at: string
        }
        Insert: {
          actual_fee?: number | null
          client_id: string
          closing_days?: number | null
          created_at?: string
          dd_days?: number | null
          dd_expiration_date?: string | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          earnest_deposit?: number | null
          escalation_pct?: number | null
          executed_date?: string | null
          flagged_new?: boolean
          free_rent_months?: number | null
          id?: string
          inquiry_date?: string
          lease_term_months?: number | null
          notes?: string | null
          owner_id: string
          payment_received?: boolean
          property_id: string
          proposed_commencement?: string | null
          proposed_lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          proposed_opex_psf?: number | null
          proposed_price?: number | null
          proposed_rate_psf?: number | null
          proposed_sf?: number | null
          renewal_terms?: string | null
          security_deposit?: number | null
          sort_order: number
          special_provisions?: string | null
          stage?: Database["public"]["Enums"]["pursuit_stage"]
          ti_allowance_psf?: number | null
          tour_date?: string | null
          tour_time?: string | null
          updated_at?: string
        }
        Update: {
          actual_fee?: number | null
          client_id?: string
          closing_days?: number | null
          created_at?: string
          dd_days?: number | null
          dd_expiration_date?: string | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          earnest_deposit?: number | null
          escalation_pct?: number | null
          executed_date?: string | null
          flagged_new?: boolean
          free_rent_months?: number | null
          id?: string
          inquiry_date?: string
          lease_term_months?: number | null
          notes?: string | null
          owner_id?: string
          payment_received?: boolean
          property_id?: string
          proposed_commencement?: string | null
          proposed_lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          proposed_opex_psf?: number | null
          proposed_price?: number | null
          proposed_rate_psf?: number | null
          proposed_sf?: number | null
          renewal_terms?: string | null
          security_deposit?: number | null
          sort_order?: number
          special_provisions?: string | null
          stage?: Database["public"]["Enums"]["pursuit_stage"]
          ti_allowance_psf?: number | null
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
          {
            foreignKeyName: "pursuits_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pursuits_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
          {
            foreignKeyName: "suggestions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
          hubspot_id: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          listing_id: string | null
          note_id: string | null
          owner_id: string
          prospect_id: string | null
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
          hubspot_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_id?: string | null
          note_id?: string | null
          owner_id: string
          prospect_id?: string | null
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
          hubspot_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          listing_id?: string | null
          note_id?: string | null
          owner_id?: string
          prospect_id?: string | null
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
            foreignKeyName: "tasks_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
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
      units: {
        Row: {
          amps: number | null
          asking_rate_psf: number | null
          clear_height_ft: number | null
          created_at: string
          dock_high_doors: number | null
          dock_levelers: number | null
          grade_level_doors: number | null
          id: string
          label: string | null
          notes: string | null
          office_sf: number | null
          property_id: string
          size_acres: number | null
          size_sf: number | null
          status: string
          three_phase_power: boolean | null
          volts: string | null
        }
        Insert: {
          amps?: number | null
          asking_rate_psf?: number | null
          clear_height_ft?: number | null
          created_at?: string
          dock_high_doors?: number | null
          dock_levelers?: number | null
          grade_level_doors?: number | null
          id?: string
          label?: string | null
          notes?: string | null
          office_sf?: number | null
          property_id: string
          size_acres?: number | null
          size_sf?: number | null
          status?: string
          three_phase_power?: boolean | null
          volts?: string | null
        }
        Update: {
          amps?: number | null
          asking_rate_psf?: number | null
          clear_height_ft?: number | null
          created_at?: string
          dock_high_doors?: number | null
          dock_levelers?: number | null
          grade_level_doors?: number | null
          id?: string
          label?: string | null
          notes?: string | null
          office_sf?: number | null
          property_id?: string
          size_acres?: number | null
          size_sf?: number | null
          status?: string
          three_phase_power?: boolean | null
          volts?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
    }
    Views: {
      v_county_market_stats: {
        Row: {
          avg_dom: number | null
          county: string | null
          land_avg_per_acre: number | null
          land_median_per_acre: number | null
          land_n: number | null
          lease_avg_psf: number | null
          lease_median_psf: number | null
          lease_n: number | null
          lease_p25_psf: number | null
          lease_p75_psf: number | null
          listing_n: number | null
          property_type: string | null
          sale_avg_cap: number | null
          sale_avg_psf: number | null
          sale_cap_n: number | null
          sale_median_psf: number | null
          sale_n: number | null
          sale_p25_psf: number | null
          sale_p75_psf: number | null
        }
        Relationships: []
      }
      v_fs_entity: {
        Row: {
          crm_id: Json | null
          entity_id: string | null
          entity_type: string | null
          prefix: string | null
        }
        Relationships: []
      }
      v_lease_comps: {
        Row: {
          address: string | null
          building_sf: number | null
          city: string | null
          commencement_date: string | null
          comp_id: string | null
          county: string | null
          days_to_expiry: number | null
          dm_email: string | null
          dm_name: string | null
          dm_phone: string | null
          dm_status: Database["public"]["Enums"]["decision_maker_status"] | null
          dm_title: string | null
          dm_verified: boolean | null
          executed_lease_rate_psf: number | null
          expiration_date: string | null
          land_acres: number | null
          lat: number | null
          lease_structure: Database["public"]["Enums"]["lease_structure"] | null
          lng: number | null
          months_since_signed: number | null
          months_to_expiry: number | null
          property_id: string | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          sf: number | null
          signed_date: string | null
          state: string | null
          tenant_company_id: string | null
          tenant_company_name: string | null
          tenant_name: string | null
          term_months: number | null
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
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
      v_property_current_asking: {
        Row: {
          as_of_date: string | null
          asking_lease_rate_psf: number | null
          cap_rate_pct: number | null
          comp_id: string | null
          deal_type: Database["public"]["Enums"]["deal_type"] | null
          property_id: string | null
          sale_price: number | null
          sf: number | null
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
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      v_property_market_position: {
        Row: {
          asking_rate_psf: number | null
          county: string | null
          good_land_deal: boolean | null
          good_lease_deal: boolean | null
          good_sale_deal: boolean | null
          id: string | null
          land_baseline_median: number | null
          land_baseline_n: number | null
          land_per_acre: number | null
          land_vs_market_pct: number | null
          lease_baseline_median: number | null
          lease_baseline_n: number | null
          lease_vs_market_pct: number | null
          property_type: string | null
          sale_baseline_median: number | null
          sale_baseline_n: number | null
          sale_psf: number | null
          sale_vs_market_pct: number | null
        }
        Relationships: []
      }
      v_property_owner_context: {
        Row: {
          best_contact_confidence:
            | Database["public"]["Enums"]["owner_contact_confidence"]
            | null
          best_contact_email: string | null
          best_contact_email_verified_at: string | null
          best_contact_name: string | null
          best_contact_phone: string | null
          comm_count: number | null
          last_contacted_at: string | null
          off_market_days: number | null
          off_market_since: string | null
          owner_confirmed_contact_count: number | null
          owner_contact_count: number | null
          owner_contact_verified: boolean | null
          owner_do_not_call: boolean | null
          owner_email_verified: boolean | null
          owner_id: string | null
          owner_kind: Database["public"]["Enums"]["owner_kind"] | null
          owner_mailing_address: string | null
          owner_name: string | null
          owner_portfolio_acres: number | null
          owner_portfolio_sf: number | null
          owner_property_count: number | null
          owner_reachable: boolean | null
          owner_tags: string[] | null
          owner_verification_status:
            | Database["public"]["Enums"]["owner_verification_status"]
            | null
          property_id: string | null
          was_on_market: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      v_recordings_to_archive: {
        Row: {
          id: string | null
          occurred_at: string | null
          phone: string | null
          source_url: string | null
        }
        Relationships: []
      }
      v_unit_specs: {
        Row: {
          amps: number | null
          amps_inherited: boolean | null
          asking_rate_psf: number | null
          clear_height_ft: number | null
          clear_height_ft_inherited: boolean | null
          dock_high_doors: number | null
          dock_high_doors_inherited: boolean | null
          dock_levelers: number | null
          dock_levelers_inherited: boolean | null
          grade_level_doors: number | null
          grade_level_doors_inherited: boolean | null
          label: string | null
          notes: string | null
          office_sf: number | null
          property_id: string | null
          size_acres: number | null
          size_sf: number | null
          status: string | null
          three_phase_power: boolean | null
          three_phase_power_inherited: boolean | null
          unit_id: string | null
          volts: string | null
          volts_inherited: boolean | null
          warehouse_sf: number | null
        }
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
    }
    Functions: {
      add_parcel_to_listing: {
        Args: {
          p_is_primary?: boolean
          p_listing_id: string
          p_property_id: string
        }
        Returns: {
          created_at: string
          is_primary: boolean
          listing_id: string
          property_id: string
        }
        SetofOptions: {
          from: "*"
          to: "listing_parcels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_suggestion: {
        Args: { p_client_id?: string; p_suggestion_id: string }
        Returns: string
      }
      buyers_covering_point: {
        Args: { p_lat: number; p_lng: number }
        Returns: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          building_sf_max: number | null
          building_sf_min: number | null
          buyer_kind: Database["public"]["Enums"]["buyer_kind"] | null
          cap_rate_min: number | null
          commission_pct: number | null
          company_id: string | null
          contact_id: string
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          exchange_1031: boolean
          exchange_deadline: string | null
          id: string
          intended_use: string | null
          is_rep: boolean
          land_acres_max: number | null
          land_acres_min: number | null
          lost_reason: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action: string | null
          next_action_date: string | null
          owner_id: string
          price_max: number | null
          price_min: number | null
          product_subclasses: Database["public"]["Enums"]["industrial_subclass"][]
          property_type: Database["public"]["Enums"]["property_kind"] | null
          purpose: Database["public"]["Enums"]["client_purpose"] | null
          rent_budget_max: number | null
          rent_budget_min: number | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["client_status"]
          strategies: Database["public"]["Enums"]["investment_strategy"][]
          target_areas: Json
          target_markets: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      classify_owner_kind: {
        Args: { p_name: string }
        Returns: Database["public"]["Enums"]["owner_kind"]
      }
      convert_prospect: {
        Args: {
          p_deal_type?: Database["public"]["Enums"]["deal_type"]
          p_prospect_id: string
          p_target: string
        }
        Returns: Json
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
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cross_reference: { Args: { p_property_ids: string[] }; Returns: Json }
      derive_pursuit_deal_type: {
        Args: { p_client_id: string; p_property_id: string }
        Returns: Database["public"]["Enums"]["deal_type"]
      }
      enrich_tenant_companies: { Args: { p: Json }; Returns: Json }
      ensure_payment_checks: { Args: never; Returns: Json }
      execute_pursuit: {
        Args: { p?: Json; p_pursuit_id: string }
        Returns: Json
      }
      flag_deal_candidates: {
        Args: { p_days?: number; p_property_ids?: string[] }
        Returns: Json
      }
      format_phone: { Args: { p: string }; Returns: string }
      fs_entity_path: {
        Args: { p_id: string; p_type: string }
        Returns: string
      }
      fs_safe_name: { Args: { p: string }; Returns: string }
      ghl_verify_owner: { Args: { p: Json }; Returns: Json }
      import_county_parcels: { Args: { p: Json }; Returns: Json }
      import_email_leads: { Args: { p: Json }; Returns: Json }
      import_hubspot_batch: { Args: { p: Json }; Returns: Json }
      import_lease_comps: { Args: { p: Json }; Returns: Json }
      import_owner_addresses: { Args: { p: Json }; Returns: Json }
      import_owner_email_leads: { Args: { p: Json }; Returns: Json }
      import_sale_history: { Args: { p: Json }; Returns: Json }
      import_scraped_listings: {
        Args: { p_client_id?: string; p_flagged_new?: boolean; p_props: Json }
        Returns: Json
      }
      import_terrakotta_batch: { Args: { p: Json }; Returns: Json }
      import_terrakotta_evidence_upgrade: {
        Args: { p_contact: string }
        Returns: undefined
      }
      intake_client: { Args: { p: Json; p_owner: string }; Returns: Json }
      intake_landlord_listing: {
        Args: { p: Json; p_owner: string }
        Returns: Json
      }
      intake_prospect: { Args: { p: Json; p_owner: string }; Returns: Json }
      link_appraiser_owner_entities: {
        Args: { p_county?: string }
        Returns: Json
      }
      mark_owners_exported: {
        Args: { p_property_ids: string[] }
        Returns: Json
      }
      match_addresses: { Args: { p: Json }; Returns: Json }
      normalize_owner_name: { Args: { p_name: string }; Returns: string }
      normalize_phone: { Args: { p: string }; Returns: string }
      normalize_street: { Args: { p_addr: string }; Returns: string }
      normalize_street_loose: { Args: { p_addr: string }; Returns: string }
      pending_geocode: { Args: { p?: Json }; Returns: Json }
      point_in_ring: {
        Args: { p_lat: number; p_lng: number; ring: Json }
        Returns: boolean
      }
      promote_client: {
        Args: { p_client_id: string }
        Returns: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          building_sf_max: number | null
          building_sf_min: number | null
          buyer_kind: Database["public"]["Enums"]["buyer_kind"] | null
          cap_rate_min: number | null
          commission_pct: number | null
          company_id: string | null
          contact_id: string
          created_at: string
          deal_type: Database["public"]["Enums"]["deal_type"]
          exchange_1031: boolean
          exchange_deadline: string | null
          id: string
          intended_use: string | null
          is_rep: boolean
          land_acres_max: number | null
          land_acres_min: number | null
          lost_reason: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action: string | null
          next_action_date: string | null
          owner_id: string
          price_max: number | null
          price_min: number | null
          product_subclasses: Database["public"]["Enums"]["industrial_subclass"][]
          property_type: Database["public"]["Enums"]["property_kind"] | null
          purpose: Database["public"]["Enums"]["client_purpose"] | null
          rent_budget_max: number | null
          rent_budget_min: number | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["client_status"]
          strategies: Database["public"]["Enums"]["investment_strategy"][]
          target_areas: Json
          target_markets: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      property_kind_from_dor: {
        Args: { p_code: string }
        Returns: Database["public"]["Enums"]["property_kind"]
      }
      refresh_suggestions: { Args: { p_days?: number }; Returns: Json }
      relink_owner_contacts: { Args: { p?: Json }; Returns: Json }
      set_property_coords: { Args: { p: Json }; Returns: Json }
      strip_html: { Args: { p: string }; Returns: string }
      suggest_properties_to_client: {
        Args: { p_client_id: string; p_property_ids: string[] }
        Returns: Json
      }
      sweep_finalize_off_market: {
        Args: { p_counties?: string[] }
        Returns: Json
      }
      sweep_mark_off_market: {
        Args: { p_seen_property_ids: string[] }
        Returns: Json
      }
      sweep_stamp_seen: {
        Args: { p_seen_property_ids: string[] }
        Returns: Json
      }
    }
    Enums: {
      buyer_kind: "investor" | "owner_user" | "developer"
      client_purpose:
        | "expansion"
        | "first_location"
        | "relocation"
        | "investment"
      client_status:
        | "prospect"
        | "searching"
        | "negotiating"
        | "closed"
        | "lost"
      comm_channel: "call" | "sms" | "email" | "note" | "meeting" | "other"
      comm_direction: "inbound" | "outbound" | "unknown"
      comm_source:
        | "hubspot"
        | "terrakotta"
        | "smartercontact"
        | "ghl"
        | "manual"
      comp_kind: "asking" | "executed"
      company_type: "landlord" | "tenant" | "broker" | "other" | "vendor"
      deal_flag_status: "pending" | "dismissed"
      deal_type: "lease" | "sale" | "both"
      decision_maker_status: "none" | "suspected" | "verified"
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
        | "rfp"
      industrial_subclass:
        | "ios"
        | "small_bay"
        | "big_box"
        | "cold_storage"
        | "flex"
        | "land_development"
      investment_strategy:
        | "value_add"
        | "core_stabilized"
        | "development"
        | "sale_leaseback"
        | "covered_land"
        | "schmuck"
      lead_source:
        | "loopnet"
        | "sign_call"
        | "cold_call"
        | "email"
        | "text"
        | "website"
        | "referral"
        | "broker"
      lease_structure: "NNN" | "NN" | "MG" | "FS" | "IG"
      listing_market_status: "on_market" | "off_market"
      listing_stage: "proposal" | "listed" | "closed"
      note_kind: "note" | "call" | "text" | "email" | "meeting" | "tour"
      owner_contact_confidence: "confirmed" | "likely" | "unconfirmed"
      owner_kind: "individual" | "entity" | "government" | "unknown"
      owner_verification_status:
        | "unverified"
        | "exported"
        | "calling"
        | "verified"
        | "unreachable"
        | "do_not_call"
      property_kind: "industrial" | "office" | "retail" | "land" | "other"
      prospect_status: "open" | "converted" | "dead"
      pursuit_stage:
        | "inquiring"
        | "confirmed"
        | "touring"
        | "interested"
        | "negotiation"
        | "due_diligence"
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
      buyer_kind: ["investor", "owner_user", "developer"],
      client_purpose: [
        "expansion",
        "first_location",
        "relocation",
        "investment",
      ],
      client_status: ["prospect", "searching", "negotiating", "closed", "lost"],
      comm_channel: ["call", "sms", "email", "note", "meeting", "other"],
      comm_direction: ["inbound", "outbound", "unknown"],
      comm_source: ["hubspot", "terrakotta", "smartercontact", "ghl", "manual"],
      comp_kind: ["asking", "executed"],
      company_type: ["landlord", "tenant", "broker", "other", "vendor"],
      deal_flag_status: ["pending", "dismissed"],
      deal_type: ["lease", "sale", "both"],
      decision_maker_status: ["none", "suspected", "verified"],
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
        "rfp",
      ],
      industrial_subclass: [
        "ios",
        "small_bay",
        "big_box",
        "cold_storage",
        "flex",
        "land_development",
      ],
      investment_strategy: [
        "value_add",
        "core_stabilized",
        "development",
        "sale_leaseback",
        "covered_land",
        "schmuck",
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
      lease_structure: ["NNN", "NN", "MG", "FS", "IG"],
      listing_market_status: ["on_market", "off_market"],
      listing_stage: ["proposal", "listed", "closed"],
      note_kind: ["note", "call", "text", "email", "meeting", "tour"],
      owner_contact_confidence: ["confirmed", "likely", "unconfirmed"],
      owner_kind: ["individual", "entity", "government", "unknown"],
      owner_verification_status: [
        "unverified",
        "exported",
        "calling",
        "verified",
        "unreachable",
        "do_not_call",
      ],
      property_kind: ["industrial", "office", "retail", "land", "other"],
      prospect_status: ["open", "converted", "dead"],
      pursuit_stage: [
        "inquiring",
        "confirmed",
        "touring",
        "interested",
        "negotiation",
        "due_diligence",
        "executed",
        "passed",
      ],
      suggestion_status: ["pending", "dismissed"],
      task_kind: ["renewal", "follow_up", "general", "tour"],
      task_status: ["open", "done"],
    },
  },
} as const
