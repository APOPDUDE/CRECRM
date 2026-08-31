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
      _fp_land_post_20260829: {
        Row: {
          grp: number | null
          id: string | null
          rn: number | null
          val: Json | null
        }
        Insert: {
          grp?: number | null
          id?: string | null
          rn?: number | null
          val?: Json | null
        }
        Update: {
          grp?: number | null
          id?: string | null
          rn?: number | null
          val?: Json | null
        }
        Relationships: []
      }
      _fp_land_pre_20260829: {
        Row: {
          grp: number | null
          id: string | null
          rn: number | null
          val: Json | null
        }
        Insert: {
          grp?: number | null
          id?: string | null
          rn?: number | null
          val?: Json | null
        }
        Update: {
          grp?: number | null
          id?: string | null
          rn?: number | null
          val?: Json | null
        }
        Relationships: []
      }
      _fp_land_subjects_20260829: {
        Row: {
          grp: number | null
          id: string | null
          rn: number | null
        }
        Insert: {
          grp?: number | null
          id?: string | null
          rn?: number | null
        }
        Update: {
          grp?: number | null
          id?: string | null
          rn?: number | null
        }
        Relationships: []
      }
      area_code_timezones: {
        Row: {
          area_code: string
          created_at: string
          tz: string
        }
        Insert: {
          area_code: string
          created_at?: string
          tz: string
        }
        Update: {
          area_code?: string
          created_at?: string
          tz?: string
        }
        Relationships: []
      }
      buyer_intakes: {
        Row: {
          client_id: string | null
          company_name: string | null
          contact_id: string | null
          created_at: string
          dismissed_reason: string | null
          email: string | null
          first_name: string | null
          ghl_contact_id: string | null
          id: string
          last_name: string | null
          phone: string | null
          raw: Json | null
          reviewed_at: string | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["buyer_intake_status"]
          tagged_at: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          dismissed_reason?: string | null
          email?: string | null
          first_name?: string | null
          ghl_contact_id?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          raw?: Json | null
          reviewed_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["buyer_intake_status"]
          tagged_at?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          dismissed_reason?: string | null
          email?: string | null
          first_name?: string | null
          ghl_contact_id?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          raw?: Json | null
          reviewed_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["buyer_intake_status"]
          tagged_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_intakes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buyer_intakes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
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
          owner_company_id: string | null
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
          owner_company_id?: string | null
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
          owner_company_id?: string | null
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
            foreignKeyName: "communications_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
            referencedRelation: "v_map_property"
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
          entity_kind: Database["public"]["Enums"]["owner_kind"] | null
          exported_at: string | null
          id: string
          industry: string | null
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          naics: string | null
          name: string
          normalized_name: string | null
          notes: string | null
          phone: string | null
          sic: string | null
          source: string | null
          tags: string[] | null
          type: Database["public"]["Enums"]["company_type"]
          updated_at: string
          website: string | null
        }
        Insert: {
          annual_revenue?: number | null
          created_at?: string
          employee_count?: number | null
          entity_kind?: Database["public"]["Enums"]["owner_kind"] | null
          exported_at?: string | null
          id?: string
          industry?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          naics?: string | null
          name: string
          normalized_name?: string | null
          notes?: string | null
          phone?: string | null
          sic?: string | null
          source?: string | null
          tags?: string[] | null
          type?: Database["public"]["Enums"]["company_type"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          annual_revenue?: number | null
          created_at?: string
          employee_count?: number | null
          entity_kind?: Database["public"]["Enums"]["owner_kind"] | null
          exported_at?: string | null
          id?: string
          industry?: string | null
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          naics?: string | null
          name?: string
          normalized_name?: string | null
          notes?: string | null
          phone?: string | null
          sic?: string | null
          source?: string | null
          tags?: string[] | null
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
          asking_lease_rate_psf_max: number | null
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          cap_rate_pct: number | null
          commencement_date: string | null
          commission_fee: number | null
          created_at: string
          days_on_market: number | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          escalations: string | null
          executed_at: string | null
          executed_lease_rate_psf: number | null
          expiration_date: string | null
          free_rent_months: number | null
          id: string
          is_auction: boolean | null
          kind: Database["public"]["Enums"]["comp_kind"]
          land_acres: number | null
          lease_structure: Database["public"]["Enums"]["lease_structure"] | null
          listed_at: string | null
          listing_building_sf: number | null
          listing_description: string | null
          listing_title: string | null
          listing_url: string | null
          normalized_tenant_name: string | null
          notes: string | null
          occupancy: string | null
          opex_psf: number | null
          owner_id: string | null
          price_per_acre: number | null
          price_per_sf: number | null
          property_id: string
          pursuit_id: string | null
          sale_conditions: string | null
          sale_price: number | null
          sale_status: string | null
          sale_type: string | null
          sf: number | null
          source: string
          source_key: string | null
          source_last_updated: string | null
          space_count: number | null
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
          asking_lease_rate_psf_max?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cap_rate_pct?: number | null
          commencement_date?: string | null
          commission_fee?: number | null
          created_at?: string
          days_on_market?: number | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          is_auction?: boolean | null
          kind?: Database["public"]["Enums"]["comp_kind"]
          land_acres?: number | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          listed_at?: string | null
          listing_building_sf?: number | null
          listing_description?: string | null
          listing_title?: string | null
          listing_url?: string | null
          normalized_tenant_name?: string | null
          notes?: string | null
          occupancy?: string | null
          opex_psf?: number | null
          owner_id?: string | null
          price_per_acre?: number | null
          price_per_sf?: number | null
          property_id: string
          pursuit_id?: string | null
          sale_conditions?: string | null
          sale_price?: number | null
          sale_status?: string | null
          sale_type?: string | null
          sf?: number | null
          source?: string
          source_key?: string | null
          source_last_updated?: string | null
          space_count?: number | null
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
          asking_lease_rate_psf_max?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cap_rate_pct?: number | null
          commencement_date?: string | null
          commission_fee?: number | null
          created_at?: string
          days_on_market?: number | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          is_auction?: boolean | null
          kind?: Database["public"]["Enums"]["comp_kind"]
          land_acres?: number | null
          lease_structure?:
            | Database["public"]["Enums"]["lease_structure"]
            | null
          listed_at?: string | null
          listing_building_sf?: number | null
          listing_description?: string | null
          listing_title?: string | null
          listing_url?: string | null
          normalized_tenant_name?: string | null
          notes?: string | null
          occupancy?: string | null
          opex_psf?: number | null
          owner_id?: string | null
          price_per_acre?: number | null
          price_per_sf?: number | null
          property_id?: string
          pursuit_id?: string | null
          sale_conditions?: string | null
          sale_price?: number | null
          sale_status?: string | null
          sale_type?: string | null
          sf?: number | null
          source?: string
          source_key?: string | null
          source_last_updated?: string | null
          space_count?: number | null
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
            referencedRelation: "v_map_property"
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
          category: Database["public"]["Enums"]["contact_category"] | null
          company_id: string | null
          created_at: string
          do_not_call: boolean
          email: string | null
          email_bounced_at: string | null
          email_campaign_id: string | null
          email_identity_suspect_at: string | null
          email_last_campaigned_at: string | null
          email_opt_out_at: string | null
          email_status:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at: string | null
          email_status_source: string | null
          email_verified_at: string | null
          first_name: string
          ghl_contact_id: string | null
          hubspot_id: string | null
          id: string
          import_addresses: string[] | null
          last_contacted_at: string | null
          last_name: string | null
          normalized_name: string | null
          notes: string | null
          phone: string | null
          phone_grade: string | null
          phone_type: string | null
          source: string | null
          terrakotta_id: string | null
          title: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          verified_evidence_id: string | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          campaign_lists?: string[] | null
          category?: Database["public"]["Enums"]["contact_category"] | null
          company_id?: string | null
          created_at?: string
          do_not_call?: boolean
          email?: string | null
          email_bounced_at?: string | null
          email_campaign_id?: string | null
          email_identity_suspect_at?: string | null
          email_last_campaigned_at?: string | null
          email_opt_out_at?: string | null
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          email_status_source?: string | null
          email_verified_at?: string | null
          first_name: string
          ghl_contact_id?: string | null
          hubspot_id?: string | null
          id?: string
          import_addresses?: string[] | null
          last_contacted_at?: string | null
          last_name?: string | null
          normalized_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_grade?: string | null
          phone_type?: string | null
          source?: string | null
          terrakotta_id?: string | null
          title?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_evidence_id?: string | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_reason?: string | null
          campaign_lists?: string[] | null
          category?: Database["public"]["Enums"]["contact_category"] | null
          company_id?: string | null
          created_at?: string
          do_not_call?: boolean
          email?: string | null
          email_bounced_at?: string | null
          email_campaign_id?: string | null
          email_identity_suspect_at?: string | null
          email_last_campaigned_at?: string | null
          email_opt_out_at?: string | null
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          email_status_source?: string | null
          email_verified_at?: string | null
          first_name?: string
          ghl_contact_id?: string | null
          hubspot_id?: string | null
          id?: string
          import_addresses?: string[] | null
          last_contacted_at?: string | null
          last_name?: string | null
          normalized_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_grade?: string | null
          phone_type?: string | null
          source?: string | null
          terrakotta_id?: string | null
          title?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_evidence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_verified_evidence_id_fkey"
            columns: ["verified_evidence_id"]
            isOneToOne: false
            referencedRelation: "communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_verified_evidence_id_fkey"
            columns: ["verified_evidence_id"]
            isOneToOne: false
            referencedRelation: "v_recordings_to_archive"
            referencedColumns: ["id"]
          },
        ]
      }
      county_land_rents: {
        Row: {
          county: string
          notes: string | null
          rent_per_acre_month: number
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          county: string
          notes?: string | null
          rent_per_acre_month: number
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          county?: string
          notes?: string | null
          rent_per_acre_month?: number
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
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
      county_market_stats: {
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
          refreshed_at: string
          sale_avg_cap: number | null
          sale_avg_psf: number | null
          sale_cap_n: number | null
          sale_median_psf: number | null
          sale_n: number | null
          sale_p25_psf: number | null
          sale_p75_psf: number | null
        }
        Insert: {
          avg_dom?: number | null
          county?: string | null
          land_avg_per_acre?: number | null
          land_median_per_acre?: number | null
          land_n?: number | null
          lease_avg_psf?: number | null
          lease_median_psf?: number | null
          lease_n?: number | null
          lease_p25_psf?: number | null
          lease_p75_psf?: number | null
          listing_n?: number | null
          property_type?: string | null
          refreshed_at?: string
          sale_avg_cap?: number | null
          sale_avg_psf?: number | null
          sale_cap_n?: number | null
          sale_median_psf?: number | null
          sale_n?: number | null
          sale_p25_psf?: number | null
          sale_p75_psf?: number | null
        }
        Update: {
          avg_dom?: number | null
          county?: string | null
          land_avg_per_acre?: number | null
          land_median_per_acre?: number | null
          land_n?: number | null
          lease_avg_psf?: number | null
          lease_median_psf?: number | null
          lease_n?: number | null
          lease_p25_psf?: number | null
          lease_p75_psf?: number | null
          listing_n?: number | null
          property_type?: string | null
          refreshed_at?: string
          sale_avg_cap?: number | null
          sale_avg_psf?: number | null
          sale_cap_n?: number | null
          sale_median_psf?: number | null
          sale_n?: number | null
          sale_p25_psf?: number | null
          sale_p75_psf?: number | null
        }
        Relationships: []
      }
      county_tax_rates: {
        Row: {
          county: string
          effective_year: number | null
          millage: number
          notes: string | null
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          county: string
          effective_year?: number | null
          millage: number
          notes?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          county?: string
          effective_year?: number | null
          millage?: number
          notes?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      deal_flag_evals: {
        Row: {
          detail: Json | null
          evaluated_at: string
          land_pct: number | null
          lease_pct: number | null
          property_id: string
          sale_pct: number | null
          stale: boolean
        }
        Insert: {
          detail?: Json | null
          evaluated_at?: string
          land_pct?: number | null
          lease_pct?: number | null
          property_id: string
          sale_pct?: number | null
          stale?: boolean
        }
        Update: {
          detail?: Json | null
          evaluated_at?: string
          land_pct?: number | null
          lease_pct?: number | null
          property_id?: string
          sale_pct?: number | null
          stale?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "deal_flag_evals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_flag_evals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_flag_evals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_flag_evals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
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
            referencedRelation: "v_map_property"
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
      deal_radar: {
        Row: {
          author_name: string | null
          category: string | null
          contact_id: string | null
          created_at: string
          external_id: string
          found_at: string
          group_id: string | null
          group_name: string | null
          id: string
          keyword: string | null
          lat: number | null
          listing_type: Database["public"]["Enums"]["deal_radar_type"]
          listing_url: string
          lng: number | null
          location_text: string | null
          market: string
          messaged_at: string | null
          notes: string | null
          owner_email: string | null
          owner_phone: string | null
          posted_at: string | null
          price: number | null
          property_id: string | null
          raw_json: Json
          size_acres: number | null
          size_sqft: number | null
          source: Database["public"]["Enums"]["deal_radar_source"]
          status: Database["public"]["Enums"]["deal_radar_status"]
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          category?: string | null
          contact_id?: string | null
          created_at?: string
          external_id: string
          found_at?: string
          group_id?: string | null
          group_name?: string | null
          id?: string
          keyword?: string | null
          lat?: number | null
          listing_type: Database["public"]["Enums"]["deal_radar_type"]
          listing_url: string
          lng?: number | null
          location_text?: string | null
          market: string
          messaged_at?: string | null
          notes?: string | null
          owner_email?: string | null
          owner_phone?: string | null
          posted_at?: string | null
          price?: number | null
          property_id?: string | null
          raw_json?: Json
          size_acres?: number | null
          size_sqft?: number | null
          source?: Database["public"]["Enums"]["deal_radar_source"]
          status?: Database["public"]["Enums"]["deal_radar_status"]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          category?: string | null
          contact_id?: string | null
          created_at?: string
          external_id?: string
          found_at?: string
          group_id?: string | null
          group_name?: string | null
          id?: string
          keyword?: string | null
          lat?: number | null
          listing_type?: Database["public"]["Enums"]["deal_radar_type"]
          listing_url?: string
          lng?: number | null
          location_text?: string | null
          market?: string
          messaged_at?: string | null
          notes?: string | null
          owner_email?: string | null
          owner_phone?: string | null
          posted_at?: string | null
          price?: number | null
          property_id?: string | null
          raw_json?: Json
          size_acres?: number | null
          size_sqft?: number | null
          source?: Database["public"]["Enums"]["deal_radar_source"]
          status?: Database["public"]["Enums"]["deal_radar_status"]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_radar_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_radar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_radar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_radar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_radar_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      deal_radar_runs: {
        Row: {
          error_detail: Json
          errors: number
          finished_at: string | null
          hits: number
          id: string
          inserted: number
          ok: boolean | null
          searches: number
          started_at: string
        }
        Insert: {
          error_detail?: Json
          errors?: number
          finished_at?: string | null
          hits?: number
          id?: string
          inserted?: number
          ok?: boolean | null
          searches?: number
          started_at?: string
        }
        Update: {
          error_detail?: Json
          errors?: number
          finished_at?: string | null
          hits?: number
          id?: string
          inserted?: number
          ok?: boolean | null
          searches?: number
          started_at?: string
        }
        Relationships: []
      }
      dor_codes: {
        Row: {
          category: string
          code: string
          description: string
          land_class: boolean
        }
        Insert: {
          category: string
          code: string
          description: string
          land_class?: boolean
        }
        Update: {
          category?: string
          code?: string
          description?: string
          land_class?: boolean
        }
        Relationships: []
      }
      dup_note_cleanup_20260814: {
        Row: {
          backed_up_at: string | null
          body: string | null
          channel: Database["public"]["Enums"]["comm_channel"] | null
          contact_id: string | null
          created_at: string | null
          direction: Database["public"]["Enums"]["comm_direction"] | null
          disposition: string | null
          external_id: string | null
          id: string | null
          occurred_at: string | null
          owner_id: string | null
          phone: string | null
          property_id: string | null
          raw: Json | null
          recording_bytes: number | null
          recording_error: string | null
          recording_path: string | null
          recording_synced_at: string | null
          rn: number | null
          source: Database["public"]["Enums"]["comm_source"] | null
          subject: string | null
          tags: string[] | null
          transcript: string | null
        }
        Insert: {
          backed_up_at?: string | null
          body?: string | null
          channel?: Database["public"]["Enums"]["comm_channel"] | null
          contact_id?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["comm_direction"] | null
          disposition?: string | null
          external_id?: string | null
          id?: string | null
          occurred_at?: string | null
          owner_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          recording_bytes?: number | null
          recording_error?: string | null
          recording_path?: string | null
          recording_synced_at?: string | null
          rn?: number | null
          source?: Database["public"]["Enums"]["comm_source"] | null
          subject?: string | null
          tags?: string[] | null
          transcript?: string | null
        }
        Update: {
          backed_up_at?: string | null
          body?: string | null
          channel?: Database["public"]["Enums"]["comm_channel"] | null
          contact_id?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["comm_direction"] | null
          disposition?: string | null
          external_id?: string | null
          id?: string | null
          occurred_at?: string | null
          owner_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          recording_bytes?: number | null
          recording_error?: string | null
          recording_path?: string | null
          recording_synced_at?: string | null
          rn?: number | null
          source?: Database["public"]["Enums"]["comm_source"] | null
          subject?: string | null
          tags?: string[] | null
          transcript?: string | null
        }
        Relationships: []
      }
      email_leads_archive: {
        Row: {
          bounced_at: string | null
          category: Database["public"]["Enums"]["contact_category"] | null
          company_name: string | null
          contact_id: string | null
          created_at: string | null
          email: string | null
          email_status:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at: string | null
          first_name: string | null
          id: string | null
          last_campaigned_at: string | null
          last_name: string | null
          last_reply_at: string | null
          last_sent_at: string | null
          lists: string[] | null
          name_source: string | null
          opted_out_at: string | null
          parcel_id: string | null
          phone: string | null
          property_address: string | null
          property_city: string | null
          property_county: string | null
          property_id: string | null
          property_state: string | null
          property_zip: string | null
          raw: Json | null
          reply_category: string | null
          sent_count: number | null
          smartlead_campaign_ids: string[] | null
          smartlead_lead_id: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          bounced_at?: string | null
          category?: Database["public"]["Enums"]["contact_category"] | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string | null
          email?: string | null
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          first_name?: string | null
          id?: string | null
          last_campaigned_at?: string | null
          last_name?: string | null
          last_reply_at?: string | null
          last_sent_at?: string | null
          lists?: string[] | null
          name_source?: string | null
          opted_out_at?: string | null
          parcel_id?: string | null
          phone?: string | null
          property_address?: string | null
          property_city?: string | null
          property_county?: string | null
          property_id?: string | null
          property_state?: string | null
          property_zip?: string | null
          raw?: Json | null
          reply_category?: string | null
          sent_count?: number | null
          smartlead_campaign_ids?: string[] | null
          smartlead_lead_id?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          bounced_at?: string | null
          category?: Database["public"]["Enums"]["contact_category"] | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string | null
          email?: string | null
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          first_name?: string | null
          id?: string | null
          last_campaigned_at?: string | null
          last_name?: string | null
          last_reply_at?: string | null
          last_sent_at?: string | null
          lists?: string[] | null
          name_source?: string | null
          opted_out_at?: string | null
          parcel_id?: string | null
          phone?: string | null
          property_address?: string | null
          property_city?: string | null
          property_county?: string | null
          property_id?: string | null
          property_state?: string | null
          property_zip?: string | null
          raw?: Json | null
          reply_category?: string | null
          sent_count?: number | null
          smartlead_campaign_ids?: string[] | null
          smartlead_lead_id?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      email_sequence_templates: {
        Row: {
          created_at: string
          description: string | null
          evidence: string | null
          id: string
          is_active: boolean
          key: string
          name: string
          purpose: Database["public"]["Enums"]["email_campaign_purpose"]
          requires_postal_address: boolean
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          evidence?: string | null
          id?: string
          is_active?: boolean
          key: string
          name: string
          purpose: Database["public"]["Enums"]["email_campaign_purpose"]
          requires_postal_address?: boolean
          steps: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          evidence?: string | null
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          purpose?: Database["public"]["Enums"]["email_campaign_purpose"]
          requires_postal_address?: boolean
          steps?: Json
          updated_at?: string
        }
        Relationships: []
      }
      enrichment_score_weights: {
        Row: {
          enabled: boolean
          factor: string
          notes: string | null
          params: Json
          updated_at: string
          weight: number
        }
        Insert: {
          enabled?: boolean
          factor: string
          notes?: string | null
          params?: Json
          updated_at?: string
          weight: number
        }
        Update: {
          enabled?: boolean
          factor?: string
          notes?: string | null
          params?: Json
          updated_at?: string
          weight?: number
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
            foreignKeyName: "files_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
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
            referencedRelation: "v_map_property"
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
      listing_space_runs: {
        Row: {
          challenges: number
          error_detail: Json | null
          errors: number
          finished_at: string | null
          id: string
          ok: boolean | null
          pages: number
          pages_ok: number
          spaces_seen: number
          started_at: string
        }
        Insert: {
          challenges?: number
          error_detail?: Json | null
          errors?: number
          finished_at?: string | null
          id?: string
          ok?: boolean | null
          pages?: number
          pages_ok?: number
          spaces_seen?: number
          started_at: string
        }
        Update: {
          challenges?: number
          error_detail?: Json | null
          errors?: number
          finished_at?: string | null
          id?: string
          ok?: boolean | null
          pages?: number
          pages_ok?: number
          spaces_seen?: number
          started_at?: string
        }
        Relationships: []
      }
      listing_spaces: {
        Row: {
          available: string | null
          build_out: string | null
          first_seen_at: string
          gone_at: string | null
          id: string
          label: string
          last_seen_at: string
          listing_id: string
          rate_psf: number | null
          size_sf: number | null
          space_use: string | null
          term: string | null
        }
        Insert: {
          available?: string | null
          build_out?: string | null
          first_seen_at?: string
          gone_at?: string | null
          id?: string
          label: string
          last_seen_at?: string
          listing_id: string
          rate_psf?: number | null
          size_sf?: number | null
          space_use?: string | null
          term?: string | null
        }
        Update: {
          available?: string | null
          build_out?: string | null
          first_seen_at?: string
          gone_at?: string | null
          id?: string
          label?: string
          last_seen_at?: string
          listing_id?: string
          rate_psf?: number | null
          size_sf?: number | null
          space_use?: string | null
          term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_spaces_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "market_listings"
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
          {
            foreignKeyName: "listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
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
      market_events: {
        Row: {
          address: string | null
          city: string | null
          county: string | null
          created_at: string
          detail: Json
          event_date: string | null
          event_type: Database["public"]["Enums"]["market_event_type"]
          first_seen_at: string
          id: string
          last_seen_at: string
          parcel_number: string | null
          property_id: string | null
          source: string
          source_key: string
          status: Database["public"]["Enums"]["market_event_status"]
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          county?: string | null
          created_at?: string
          detail?: Json
          event_date?: string | null
          event_type: Database["public"]["Enums"]["market_event_type"]
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          parcel_number?: string | null
          property_id?: string | null
          source: string
          source_key: string
          status?: Database["public"]["Enums"]["market_event_status"]
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          county?: string | null
          created_at?: string
          detail?: Json
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["market_event_type"]
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          parcel_number?: string | null
          property_id?: string | null
          source?: string
          source_key?: string
          status?: Database["public"]["Enums"]["market_event_status"]
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      market_listings: {
        Row: {
          asking_price: number | null
          asking_rate_psf: number | null
          asking_rate_psf_max: number | null
          broker_company: string | null
          broker_name: string | null
          building_sf: number | null
          cap_rate_pct: number | null
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          listing_type: Database["public"]["Enums"]["deal_type"]
          off_market_at: string | null
          property_id: string
          raw: Json | null
          source: string
          source_listing_id: string
          space_count: number | null
          sqft: number | null
          status: Database["public"]["Enums"]["listing_market_status"]
          updated_at: string
          url: string | null
        }
        Insert: {
          asking_price?: number | null
          asking_rate_psf?: number | null
          asking_rate_psf_max?: number | null
          broker_company?: string | null
          broker_name?: string | null
          building_sf?: number | null
          cap_rate_pct?: number | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          listing_type: Database["public"]["Enums"]["deal_type"]
          off_market_at?: string | null
          property_id: string
          raw?: Json | null
          source?: string
          source_listing_id: string
          space_count?: number | null
          sqft?: number | null
          status?: Database["public"]["Enums"]["listing_market_status"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          asking_price?: number | null
          asking_rate_psf?: number | null
          asking_rate_psf_max?: number | null
          broker_company?: string | null
          broker_name?: string | null
          building_sf?: number | null
          cap_rate_pct?: number | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          listing_type?: Database["public"]["Enums"]["deal_type"]
          off_market_at?: string | null
          property_id?: string
          raw?: Json | null
          source?: string
          source_listing_id?: string
          space_count?: number | null
          sqft?: number | null
          status?: Database["public"]["Enums"]["listing_market_status"]
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_listings_property_id_fkey"
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
            referencedRelation: "v_map_property"
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
      outreach_calls: {
        Row: {
          attempts: number
          created_at: string
          disposition: string | null
          dnc: boolean
          ghl_contact_id: string | null
          id: string
          last_call_at: string | null
          line_type: string | null
          phone: string
          phone_grade: string | null
          target_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          disposition?: string | null
          dnc?: boolean
          ghl_contact_id?: string | null
          id?: string
          last_call_at?: string | null
          line_type?: string | null
          phone: string
          phone_grade?: string | null
          target_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          disposition?: string | null
          dnc?: boolean
          ghl_contact_id?: string | null
          id?: string
          last_call_at?: string | null
          line_type?: string | null
          phone?: string
          phone_grade?: string | null
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_calls_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "outreach_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_email: {
        Row: {
          bounced_at: string | null
          created_at: string
          email: string
          email_status:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at: string | null
          email_verified_at: string | null
          id: string
          last_campaigned_at: string | null
          last_reply_at: string | null
          last_sent_at: string | null
          opted_out_at: string | null
          reply_category: string | null
          sent_count: number
          target_id: string
          updated_at: string
        }
        Insert: {
          bounced_at?: string | null
          created_at?: string
          email: string
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          email_verified_at?: string | null
          id?: string
          last_campaigned_at?: string | null
          last_reply_at?: string | null
          last_sent_at?: string | null
          opted_out_at?: string | null
          reply_category?: string | null
          sent_count?: number
          target_id: string
          updated_at?: string
        }
        Update: {
          bounced_at?: string | null
          created_at?: string
          email?: string
          email_status?:
            | Database["public"]["Enums"]["email_deliverability"]
            | null
          email_status_at?: string | null
          email_verified_at?: string | null
          id?: string
          last_campaigned_at?: string | null
          last_reply_at?: string | null
          last_sent_at?: string | null
          opted_out_at?: string | null
          reply_category?: string | null
          sent_count?: number
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_email_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "outreach_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_exports: {
        Row: {
          created_at: string
          id: string
          name: string
          property_ids: string[]
          row_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          property_ids?: string[]
          row_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          property_ids?: string[]
          row_count?: number
        }
        Relationships: []
      }
      outreach_mail: {
        Row: {
          created_at: string
          id: string
          mail_address: string
          mail_city: string | null
          mail_state: string | null
          mail_status: string | null
          mail_zip: string | null
          qr_code: string | null
          scanned_at: string | null
          sent_at: string | null
          target_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mail_address: string
          mail_city?: string | null
          mail_state?: string | null
          mail_status?: string | null
          mail_zip?: string | null
          qr_code?: string | null
          scanned_at?: string | null
          sent_at?: string | null
          target_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mail_address?: string
          mail_city?: string | null
          mail_state?: string | null
          mail_status?: string | null
          mail_zip?: string | null
          qr_code?: string | null
          scanned_at?: string | null
          sent_at?: string | null
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_mail_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "outreach_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_targets: {
        Row: {
          company_id: string | null
          company_name: string | null
          contact_id: string | null
          created_at: string
          email: string | null
          first_name: string | null
          hold_reason: string | null
          id: string
          last_name: string | null
          lists: string[]
          mailing_address: string | null
          mailing_city: string | null
          mailing_state: string | null
          mailing_zip: string | null
          name_source: string | null
          parcel_id: string | null
          phone: string | null
          property_id: string | null
          raw: Json | null
          source: string
          updated_at: string
          wrong_person_at: string | null
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          hold_reason?: string | null
          id?: string
          last_name?: string | null
          lists?: string[]
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          name_source?: string | null
          parcel_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          source: string
          updated_at?: string
          wrong_person_at?: string | null
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          hold_reason?: string | null
          id?: string
          last_name?: string | null
          lists?: string[]
          mailing_address?: string | null
          mailing_city?: string | null
          mailing_state?: string | null
          mailing_zip?: string | null
          name_source?: string | null
          parcel_id?: string | null
          phone?: string | null
          property_id?: string | null
          raw?: Json | null
          source?: string
          updated_at?: string
          wrong_person_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_targets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_targets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_targets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_targets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_targets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      outreach_texts: {
        Row: {
          blooio_chat_id: string | null
          created_at: string
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          phone: string
          protocol: Database["public"]["Enums"]["msg_protocol"]
          queue_state: string
          target_id: string
          triage: Database["public"]["Enums"]["triage_label"] | null
          triage_confidence: number | null
          updated_at: string
        }
        Insert: {
          blooio_chat_id?: string | null
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          phone: string
          protocol?: Database["public"]["Enums"]["msg_protocol"]
          queue_state?: string
          target_id: string
          triage?: Database["public"]["Enums"]["triage_label"] | null
          triage_confidence?: number | null
          updated_at?: string
        }
        Update: {
          blooio_chat_id?: string | null
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          phone?: string
          protocol?: Database["public"]["Enums"]["msg_protocol"]
          queue_state?: string
          target_id?: string
          triage?: Database["public"]["Enums"]["triage_label"] | null
          triage_confidence?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_texts_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "outreach_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_enrichment: {
        Row: {
          broadband_fiber: boolean | null
          broadband_max_down_mbps: number | null
          broadband_provider_count: number | null
          created_at: string
          csx_mainline_mi: number | null
          drainage_class: string | null
          electric_provider: string | null
          fema_flood_zone: string | null
          flu_code: string | null
          flu_description: string | null
          flu_jurisdiction: string | null
          frontage_aadt: number | null
          frontage_road_name: string | null
          gas_operator: string | null
          gas_transmission_dist_ft: number | null
          hydric_soils_pct: number | null
          in_sewer_service_area: boolean | null
          in_water_service_area: boolean | null
          interchange_drive_min: number | null
          interchange_mi: number | null
          nearest_powered_parcel_ft: number | null
          on_truck_route: boolean | null
          parcel_depth_ft: number | null
          parcel_width_ft: number | null
          pct_floodway: number | null
          pct_sfha: number | null
          property_id: string
          rectangularity: number | null
          road_frontage_ft: number | null
          score_breakdown: Json | null
          score_version: string | null
          scored_at: string | null
          sewer_force_dist_ft: number | null
          sewer_gravity_dist_ft: number | null
          sewer_provider: string | null
          slope_mean_pct: number | null
          source_status: Json
          substation_dist_ft: number | null
          suitability_score: number | null
          transmission_kv: number | null
          transmission_line_dist_ft: number | null
          updated_at: string
          water_main_diameter_in: number | null
          water_main_dist_ft: number | null
          water_provider: string | null
          wetlands_pct: number | null
        }
        Insert: {
          broadband_fiber?: boolean | null
          broadband_max_down_mbps?: number | null
          broadband_provider_count?: number | null
          created_at?: string
          csx_mainline_mi?: number | null
          drainage_class?: string | null
          electric_provider?: string | null
          fema_flood_zone?: string | null
          flu_code?: string | null
          flu_description?: string | null
          flu_jurisdiction?: string | null
          frontage_aadt?: number | null
          frontage_road_name?: string | null
          gas_operator?: string | null
          gas_transmission_dist_ft?: number | null
          hydric_soils_pct?: number | null
          in_sewer_service_area?: boolean | null
          in_water_service_area?: boolean | null
          interchange_drive_min?: number | null
          interchange_mi?: number | null
          nearest_powered_parcel_ft?: number | null
          on_truck_route?: boolean | null
          parcel_depth_ft?: number | null
          parcel_width_ft?: number | null
          pct_floodway?: number | null
          pct_sfha?: number | null
          property_id: string
          rectangularity?: number | null
          road_frontage_ft?: number | null
          score_breakdown?: Json | null
          score_version?: string | null
          scored_at?: string | null
          sewer_force_dist_ft?: number | null
          sewer_gravity_dist_ft?: number | null
          sewer_provider?: string | null
          slope_mean_pct?: number | null
          source_status?: Json
          substation_dist_ft?: number | null
          suitability_score?: number | null
          transmission_kv?: number | null
          transmission_line_dist_ft?: number | null
          updated_at?: string
          water_main_diameter_in?: number | null
          water_main_dist_ft?: number | null
          water_provider?: string | null
          wetlands_pct?: number | null
        }
        Update: {
          broadband_fiber?: boolean | null
          broadband_max_down_mbps?: number | null
          broadband_provider_count?: number | null
          created_at?: string
          csx_mainline_mi?: number | null
          drainage_class?: string | null
          electric_provider?: string | null
          fema_flood_zone?: string | null
          flu_code?: string | null
          flu_description?: string | null
          flu_jurisdiction?: string | null
          frontage_aadt?: number | null
          frontage_road_name?: string | null
          gas_operator?: string | null
          gas_transmission_dist_ft?: number | null
          hydric_soils_pct?: number | null
          in_sewer_service_area?: boolean | null
          in_water_service_area?: boolean | null
          interchange_drive_min?: number | null
          interchange_mi?: number | null
          nearest_powered_parcel_ft?: number | null
          on_truck_route?: boolean | null
          parcel_depth_ft?: number | null
          parcel_width_ft?: number | null
          pct_floodway?: number | null
          pct_sfha?: number | null
          property_id?: string
          rectangularity?: number | null
          road_frontage_ft?: number | null
          score_breakdown?: Json | null
          score_version?: string | null
          scored_at?: string | null
          sewer_force_dist_ft?: number | null
          sewer_gravity_dist_ft?: number | null
          sewer_provider?: string | null
          slope_mean_pct?: number | null
          source_status?: Json
          substation_dist_ft?: number | null
          suitability_score?: number | null
          transmission_kv?: number | null
          transmission_line_dist_ft?: number | null
          updated_at?: string
          water_main_diameter_in?: number | null
          water_main_dist_ft?: number | null
          water_provider?: string | null
          wetlands_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parcel_enrichment_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_enrichment_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_enrichment_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcel_enrichment_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      phone_scrubs: {
        Row: {
          created_at: string
          federal_dnc: boolean | null
          id: string
          line_type: string | null
          litigator: boolean | null
          phone: string
          raw: Json | null
          rnd_ok: boolean | null
          scrubbed_at: string
          state_dnc: boolean | null
          vendor: string
        }
        Insert: {
          created_at?: string
          federal_dnc?: boolean | null
          id?: string
          line_type?: string | null
          litigator?: boolean | null
          phone: string
          raw?: Json | null
          rnd_ok?: boolean | null
          scrubbed_at?: string
          state_dnc?: boolean | null
          vendor: string
        }
        Update: {
          created_at?: string
          federal_dnc?: boolean | null
          id?: string
          line_type?: string | null
          litigator?: boolean | null
          phone?: string
          raw?: Json | null
          rnd_ok?: boolean | null
          scrubbed_at?: string
          state_dnc?: boolean | null
          vendor?: string
        }
        Relationships: []
      }
      phone_suppressions: {
        Row: {
          created_at: string
          evidence: Json | null
          expires_at: string | null
          id: string
          phone: string
          reason: Database["public"]["Enums"]["suppression_reason"]
          source: string
          suppressed_at: string
        }
        Insert: {
          created_at?: string
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          phone: string
          reason: Database["public"]["Enums"]["suppression_reason"]
          source: string
          suppressed_at?: string
        }
        Update: {
          created_at?: string
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          phone?: string
          reason?: Database["public"]["Enums"]["suppression_reason"]
          source?: string
          suppressed_at?: string
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
          building_class: string | null
          building_far: string | null
          city: string | null
          clear_height_ft: number | null
          column_spacing: string | null
          construction_material: string | null
          construction_status: string | null
          county: string | null
          county_synced_at: string | null
          created_at: string
          cross_docks: boolean | null
          description: string | null
          dock_high_doors: number | null
          dock_levelers: number | null
          dor_use_code: string | null
          folio: string | null
          grade_level_doors: number | null
          gross_leasable_area: string | null
          gross_sf: number | null
          heated_sf: number | null
          id: string
          in_land_book: boolean
          is_condo_unit: boolean
          just_value: number | null
          land_acres: number | null
          land_just_value: number | null
          land_only: boolean
          land_value_share: number | null
          last_sale_date: string | null
          last_sale_price: number | null
          last_seen_in_sweep: string | null
          lat: number | null
          listing_status: Database["public"]["Enums"]["listing_market_status"]
          lng: number | null
          loopnet_property_id: number | null
          lowlands_acres_county: number | null
          net_usable_acres: number | null
          num_units: number | null
          on_ground_lease: boolean | null
          opportunity_zone: boolean | null
          owner_company_id: string | null
          owner_mailing_address: string | null
          owner_name: string | null
          parcel_key: string | null
          parcel_number: string | null
          parking_ratio: string | null
          parking_spaces: number | null
          photo_urls: string[] | null
          property_sub_types: string[] | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          scrape_facts: Json | null
          scraped_at: string | null
          search_text: string | null
          site_address: string | null
          source: string | null
          source_key: string | null
          specs: string | null
          sprinkler_system: string | null
          state: string | null
          stories: number | null
          tags: string[] | null
          three_phase_power: boolean | null
          title: string | null
          truck_court_ft: number | null
          updated_at: string
          usable_acres: number | null
          usable_acres_source: string | null
          usable_acres_updated_at: string | null
          volts: string | null
          wet_acres_nwi: number | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
          zoning_code: string | null
          zoning_description: string | null
          zoning_district: string | null
          zoning_jurisdiction: string | null
          zoning_type: Database["public"]["Enums"]["zoning_kind"] | null
          zoning_updated_at: string | null
        }
        Insert: {
          address: string
          amps?: number | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
          building_class?: string | null
          building_far?: string | null
          city?: string | null
          clear_height_ft?: number | null
          column_spacing?: string | null
          construction_material?: string | null
          construction_status?: string | null
          county?: string | null
          county_synced_at?: string | null
          created_at?: string
          cross_docks?: boolean | null
          description?: string | null
          dock_high_doors?: number | null
          dock_levelers?: number | null
          dor_use_code?: string | null
          folio?: string | null
          grade_level_doors?: number | null
          gross_leasable_area?: string | null
          gross_sf?: number | null
          heated_sf?: number | null
          id?: string
          in_land_book?: boolean
          is_condo_unit?: boolean
          just_value?: number | null
          land_acres?: number | null
          land_just_value?: number | null
          land_only?: boolean
          land_value_share?: number | null
          last_sale_date?: string | null
          last_sale_price?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          lng?: number | null
          loopnet_property_id?: number | null
          lowlands_acres_county?: number | null
          net_usable_acres?: number | null
          num_units?: number | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_company_id?: string | null
          owner_mailing_address?: string | null
          owner_name?: string | null
          parcel_key?: string | null
          parcel_number?: string | null
          parking_ratio?: string | null
          parking_spaces?: number | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          scrape_facts?: Json | null
          scraped_at?: string | null
          search_text?: string | null
          site_address?: string | null
          source?: string | null
          source_key?: string | null
          specs?: string | null
          sprinkler_system?: string | null
          state?: string | null
          stories?: number | null
          tags?: string[] | null
          three_phase_power?: boolean | null
          title?: string | null
          truck_court_ft?: number | null
          updated_at?: string
          usable_acres?: number | null
          usable_acres_source?: string | null
          usable_acres_updated_at?: string | null
          volts?: string | null
          wet_acres_nwi?: number | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_code?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
          zoning_jurisdiction?: string | null
          zoning_type?: Database["public"]["Enums"]["zoning_kind"] | null
          zoning_updated_at?: string | null
        }
        Update: {
          address?: string
          amps?: number | null
          appraiser_data?: Json | null
          appraiser_updated_at?: string | null
          assessed_value?: number | null
          building_class?: string | null
          building_far?: string | null
          city?: string | null
          clear_height_ft?: number | null
          column_spacing?: string | null
          construction_material?: string | null
          construction_status?: string | null
          county?: string | null
          county_synced_at?: string | null
          created_at?: string
          cross_docks?: boolean | null
          description?: string | null
          dock_high_doors?: number | null
          dock_levelers?: number | null
          dor_use_code?: string | null
          folio?: string | null
          grade_level_doors?: number | null
          gross_leasable_area?: string | null
          gross_sf?: number | null
          heated_sf?: number | null
          id?: string
          in_land_book?: boolean
          is_condo_unit?: boolean
          just_value?: number | null
          land_acres?: number | null
          land_just_value?: number | null
          land_only?: boolean
          land_value_share?: number | null
          last_sale_date?: string | null
          last_sale_price?: number | null
          last_seen_in_sweep?: string | null
          lat?: number | null
          listing_status?: Database["public"]["Enums"]["listing_market_status"]
          lng?: number | null
          loopnet_property_id?: number | null
          lowlands_acres_county?: number | null
          net_usable_acres?: number | null
          num_units?: number | null
          on_ground_lease?: boolean | null
          opportunity_zone?: boolean | null
          owner_company_id?: string | null
          owner_mailing_address?: string | null
          owner_name?: string | null
          parcel_key?: string | null
          parcel_number?: string | null
          parking_ratio?: string | null
          parking_spaces?: number | null
          photo_urls?: string[] | null
          property_sub_types?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          scrape_facts?: Json | null
          scraped_at?: string | null
          search_text?: string | null
          site_address?: string | null
          source?: string | null
          source_key?: string | null
          specs?: string | null
          sprinkler_system?: string | null
          state?: string | null
          stories?: number | null
          tags?: string[] | null
          three_phase_power?: boolean | null
          title?: string | null
          truck_court_ft?: number | null
          updated_at?: string
          usable_acres?: number | null
          usable_acres_source?: string | null
          usable_acres_updated_at?: string | null
          volts?: string | null
          wet_acres_nwi?: number | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
          zoning_code?: string | null
          zoning_description?: string | null
          zoning_district?: string | null
          zoning_jurisdiction?: string | null
          zoning_type?: Database["public"]["Enums"]["zoning_kind"] | null
          zoning_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      property_market_position: {
        Row: {
          asking_rate_psf: number | null
          county: string | null
          good_land_deal: boolean | null
          good_lease_deal: boolean | null
          good_sale_deal: boolean | null
          id: string
          land_baseline_median: number | null
          land_baseline_n: number | null
          land_per_acre: number | null
          land_vs_market_pct: number | null
          lease_baseline_median: number | null
          lease_baseline_n: number | null
          lease_vs_market_pct: number | null
          property_type: string | null
          refreshed_at: string
          sale_baseline_median: number | null
          sale_baseline_n: number | null
          sale_psf: number | null
          sale_vs_market_pct: number | null
        }
        Insert: {
          asking_rate_psf?: number | null
          county?: string | null
          good_land_deal?: boolean | null
          good_lease_deal?: boolean | null
          good_sale_deal?: boolean | null
          id: string
          land_baseline_median?: number | null
          land_baseline_n?: number | null
          land_per_acre?: number | null
          land_vs_market_pct?: number | null
          lease_baseline_median?: number | null
          lease_baseline_n?: number | null
          lease_vs_market_pct?: number | null
          property_type?: string | null
          refreshed_at?: string
          sale_baseline_median?: number | null
          sale_baseline_n?: number | null
          sale_psf?: number | null
          sale_vs_market_pct?: number | null
        }
        Update: {
          asking_rate_psf?: number | null
          county?: string | null
          good_land_deal?: boolean | null
          good_lease_deal?: boolean | null
          good_sale_deal?: boolean | null
          id?: string
          land_baseline_median?: number | null
          land_baseline_n?: number | null
          land_per_acre?: number | null
          land_vs_market_pct?: number | null
          lease_baseline_median?: number | null
          lease_baseline_n?: number | null
          lease_vs_market_pct?: number | null
          property_type?: string | null
          refreshed_at?: string
          sale_baseline_median?: number | null
          sale_baseline_n?: number | null
          sale_psf?: number | null
          sale_vs_market_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_market_position_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_market_position_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_market_position_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_market_position_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      property_owner_rollup: {
        Row: {
          best_contact_confidence: string | null
          best_contact_email: string | null
          best_contact_email_verified_at: string | null
          best_contact_name: string | null
          best_contact_phone: string | null
          best_contact_phone_key: string | null
          comm_count: number
          last_contacted_at: string | null
          owner_company_id: string | null
          owner_contact_verified: boolean
          owner_do_not_call: boolean
          owner_email_verified: boolean
          owner_name: string | null
          owner_property_count: number
          owner_reachable: boolean
          owner_verification_status: string | null
          property_id: string
          refreshed_at: string
        }
        Insert: {
          best_contact_confidence?: string | null
          best_contact_email?: string | null
          best_contact_email_verified_at?: string | null
          best_contact_name?: string | null
          best_contact_phone?: string | null
          best_contact_phone_key?: string | null
          comm_count?: number
          last_contacted_at?: string | null
          owner_company_id?: string | null
          owner_contact_verified?: boolean
          owner_do_not_call?: boolean
          owner_email_verified?: boolean
          owner_name?: string | null
          owner_property_count?: number
          owner_reachable?: boolean
          owner_verification_status?: string | null
          property_id: string
          refreshed_at?: string
        }
        Update: {
          best_contact_confidence?: string | null
          best_contact_email?: string | null
          best_contact_email_verified_at?: string | null
          best_contact_name?: string | null
          best_contact_phone?: string | null
          best_contact_phone_key?: string | null
          comm_count?: number
          last_contacted_at?: string | null
          owner_company_id?: string | null
          owner_contact_verified?: boolean
          owner_do_not_call?: boolean
          owner_email_verified?: boolean
          owner_name?: string | null
          owner_property_count?: number
          owner_reachable?: boolean
          owner_verification_status?: string | null
          property_id?: string
          refreshed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_owner_rollup_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_owner_rollup_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_owner_rollup_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_owner_rollup_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
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
            referencedRelation: "v_map_property"
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
            referencedRelation: "v_map_property"
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
      send_authorizations: {
        Row: {
          approved_by: string | null
          authorized_at: string
          checks: Json
          created_at: string
          id: string
          phone: string
          scrub_vendor: string | null
          scrubbed_at: string
          send_id: string
          template_hash: string | null
        }
        Insert: {
          approved_by?: string | null
          authorized_at?: string
          checks: Json
          created_at?: string
          id?: string
          phone: string
          scrub_vendor?: string | null
          scrubbed_at: string
          send_id: string
          template_hash?: string | null
        }
        Update: {
          approved_by?: string | null
          authorized_at?: string
          checks?: Json
          created_at?: string
          id?: string
          phone?: string
          scrub_vendor?: string | null
          scrubbed_at?: string
          send_id?: string
          template_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "send_authorizations_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "text_sends"
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
          {
            foreignKeyName: "suggestions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
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
      sweep_runs: {
        Row: {
          actor_id: string | null
          county: string | null
          created_at: string
          deal_type: string | null
          error: string | null
          finished_at: string | null
          id: string
          imported: number | null
          item_count: number | null
          property_type: string | null
          run_id: string | null
          source: string
          start_url: string | null
          started_at: string | null
          status: string
          urls_expected: number | null
          urls_ok: number | null
        }
        Insert: {
          actor_id?: string | null
          county?: string | null
          created_at?: string
          deal_type?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          imported?: number | null
          item_count?: number | null
          property_type?: string | null
          run_id?: string | null
          source?: string
          start_url?: string | null
          started_at?: string | null
          status: string
          urls_expected?: number | null
          urls_ok?: number | null
        }
        Update: {
          actor_id?: string | null
          county?: string | null
          created_at?: string
          deal_type?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          imported?: number | null
          item_count?: number | null
          property_type?: string | null
          run_id?: string | null
          source?: string
          start_url?: string | null
          started_at?: string | null
          status?: string
          urls_expected?: number | null
          urls_ok?: number | null
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
      text_campaigns: {
        Row: {
          created_at: string
          daily_cap: number
          id: string
          name: string
          status: string
          template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_cap?: number
          id?: string
          name: string
          status?: string
          template: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_cap?: number
          id?: string
          name?: string
          status?: string
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
      text_messages: {
        Row: {
          blooio_message_id: string | null
          body: string | null
          campaign_id: string | null
          created_at: string
          delivered_at: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          error: string | null
          id: string
          phone: string
          protocol: Database["public"]["Enums"]["msg_protocol"]
          raw: Json | null
          read_at: string | null
          send_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          blooio_message_id?: string | null
          body?: string | null
          campaign_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          id?: string
          phone: string
          protocol?: Database["public"]["Enums"]["msg_protocol"]
          raw?: Json | null
          read_at?: string | null
          send_id?: string | null
          sent_at?: string | null
          status: string
        }
        Update: {
          blooio_message_id?: string | null
          body?: string | null
          campaign_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          id?: string
          phone?: string
          protocol?: Database["public"]["Enums"]["msg_protocol"]
          raw?: Json | null
          read_at?: string | null
          send_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "text_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_messages_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "text_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      text_sends: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          blocked_reason: string | null
          blooio_message_id: string | null
          body: string
          campaign_id: string | null
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          phone: string
          sent_at: string | null
          status: Database["public"]["Enums"]["text_send_status"]
          target_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          blocked_reason?: string | null
          blooio_message_id?: string | null
          body: string
          campaign_id?: string | null
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          phone: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["text_send_status"]
          target_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          blocked_reason?: string | null
          blooio_message_id?: string | null
          body?: string
          campaign_id?: string | null
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          phone?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["text_send_status"]
          target_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "text_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_sends_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "outreach_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      texting_settings: {
        Row: {
          created_at: string
          id: number
          paused: boolean
          per_line_daily_cap: number
          quiet_cutoff: string
          quiet_start: string
          ramp_started_on: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: number
          paused?: boolean
          per_line_daily_cap?: number
          quiet_cutoff?: string
          quiet_start?: string
          ramp_started_on?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          paused?: boolean
          per_line_daily_cap?: number
          quiet_cutoff?: string
          quiet_start?: string
          ramp_started_on?: string | null
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "v_map_property"
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
      user_prefs: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      valuation_comp_exclusions: {
        Row: {
          comp_id: string
          created_at: string
          property_id: string
          reason: string | null
        }
        Insert: {
          comp_id: string
          created_at?: string
          property_id: string
          reason?: string | null
        }
        Update: {
          comp_id?: string
          created_at?: string
          property_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "valuation_comp_exclusions_comp_id_fkey"
            columns: ["comp_id"]
            isOneToOne: false
            referencedRelation: "comps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_comp_id_fkey"
            columns: ["comp_id"]
            isOneToOne: false
            referencedRelation: "v_lease_comps"
            referencedColumns: ["comp_id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_comp_id_fkey"
            columns: ["comp_id"]
            isOneToOne: false
            referencedRelation: "v_property_current_asking"
            referencedColumns: ["comp_id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_map_property"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_market_position"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_comp_exclusions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "v_property_owner_context"
            referencedColumns: ["property_id"]
          },
        ]
      }
      valuation_params: {
        Row: {
          key: string
          notes: string | null
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          notes?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          key?: string
          notes?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      zoning_code_map: {
        Row: {
          allows_industrial: boolean
          code: string
          created_at: string
          description: string | null
          jurisdiction: string
          notes: string | null
          updated_at: string
          verified: boolean
          zoning_type: Database["public"]["Enums"]["zoning_kind"]
        }
        Insert: {
          allows_industrial?: boolean
          code: string
          created_at?: string
          description?: string | null
          jurisdiction: string
          notes?: string | null
          updated_at?: string
          verified?: boolean
          zoning_type: Database["public"]["Enums"]["zoning_kind"]
        }
        Update: {
          allows_industrial?: boolean
          code?: string
          created_at?: string
          description?: string | null
          jurisdiction?: string
          notes?: string | null
          updated_at?: string
          verified?: boolean
          zoning_type?: Database["public"]["Enums"]["zoning_kind"]
        }
        Relationships: []
      }
    }
    Views: {
      v_comp_class_premium: {
        Row: {
          bucket: string | null
          building_class: string | null
          factor: number | null
          n: number | null
          ptype: string | null
        }
        Relationships: []
      }
      v_comp_size_elasticity: {
        Row: {
          beta: number | null
          bucket: string | null
          n: number | null
          ptype: string | null
        }
        Relationships: []
      }
      v_county_dor_codes: {
        Row: {
          code: string | null
          county: string | null
          property_count: number | null
        }
        Relationships: []
      }
      v_county_land_metrics: {
        Row: {
          county: string | null
          excess_acre_value: number | null
          med_psf: number | null
          n: number | null
          n_excess: number | null
          typ_coverage: number | null
        }
        Relationships: []
      }
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
      v_excess_land_decay: {
        Row: {
          beta: number | null
          med_excess_acres: number | null
          n: number | null
          r: number | null
        }
        Relationships: []
      }
      v_fs_entity: {
        Row: {
          crm_id: Json | null
          entity_id: string | null
          entity_type: string | null
          prefix: string | null
          target: string | null
        }
        Relationships: []
      }
      v_fs_entity_all: {
        Row: {
          crm_id: Json | null
          entity_id: string | null
          entity_type: string | null
          keep: boolean | null
          prefix: string | null
          target: string | null
        }
        Relationships: []
      }
      v_lease_comps: {
        Row: {
          address: string | null
          city: string | null
          commencement_date: string | null
          comp_id: string | null
          county: string | null
          days_to_expiry: number | null
          dm_email: string | null
          dm_name: string | null
          dm_phone: string | null
          dm_status: string | null
          dm_title: string | null
          dm_verified: boolean | null
          executed_lease_rate_psf: number | null
          expiration_date: string | null
          gross_sf: number | null
          heated_sf: number | null
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
            referencedRelation: "v_map_property"
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
      v_map_property: {
        Row: {
          address: string | null
          city: string | null
          county: string | null
          created_at: string | null
          days_on_market: number | null
          dor_use_code: string | null
          folio: string | null
          gross_sf: number | null
          id: string | null
          in_land_book: boolean | null
          is_condo_unit: boolean | null
          land_acres: number | null
          land_only: boolean | null
          last_sale_date: string | null
          last_sale_price: number | null
          lat: number | null
          listing_count: number | null
          listing_status:
            | Database["public"]["Enums"]["listing_market_status"]
            | null
          listing_url: string | null
          lng: number | null
          occupancy: string | null
          owner_company_id: string | null
          owner_mailing_address: string | null
          owner_name: string | null
          parcel_number: string | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          pursuit_count: number | null
          site_address: string | null
          source_address: string | null
          specs: string | null
          state: string | null
          updated_at: string | null
          year_built: number | null
          zip: string | null
          zoning_code: string | null
          zoning_description: string | null
          zoning_district: string | null
          zoning_jurisdiction: string | null
          zoning_type: Database["public"]["Enums"]["zoning_kind"] | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_outreach_lists: {
        Row: {
          held: number | null
          last_import_at: string | null
          list: string | null
          never_answered: number | null
          reached: number | null
          targets: number | null
          with_email: number | null
          with_mail: number | null
          with_phone: number | null
          with_property: number | null
        }
        Relationships: []
      }
      v_outreach_verified_property: {
        Row: {
          property_id: string | null
        }
        Relationships: []
      }
      v_property_available_space: {
        Row: {
          asking_rate_psf: number | null
          label: string | null
          property_id: string | null
          size_acres: number | null
          size_sf: number | null
          space_source: string | null
        }
        Relationships: []
      }
      v_property_current_asking: {
        Row: {
          as_of_date: string | null
          asking_lease_rate_psf: number | null
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          cap_rate_pct: number | null
          comp_id: string | null
          days_on_market: number | null
          deal_type: Database["public"]["Enums"]["deal_type"] | null
          is_auction: boolean | null
          listed_at: string | null
          listing_description: string | null
          listing_title: string | null
          listing_url: string | null
          occupancy: string | null
          property_id: string | null
          sale_conditions: string | null
          sale_price: number | null
          sale_status: string | null
          sale_type: string | null
          sf: number | null
          source_last_updated: string | null
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
            referencedRelation: "v_map_property"
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
          best_contact_confidence: string | null
          best_contact_email: string | null
          best_contact_email_verified_at: string | null
          best_contact_name: string | null
          best_contact_phone: string | null
          comm_count: number | null
          last_contacted_at: string | null
          off_market_days: number | null
          off_market_since: string | null
          owner_company_id: string | null
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
          owner_verification_status: string | null
          property_id: string | null
          was_on_market: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      v_sweep_actor_health: {
        Row: {
          day: string | null
          delivered: number | null
          items: number | null
          last_error: string | null
          pct_delivered: number | null
          runs: number | null
          source: string | null
        }
        Relationships: []
      }
      v_sweep_coverage: {
        Row: {
          county: string | null
          fresh_now: boolean | null
          hours_since_sweep: number | null
          last_sweep_at: string | null
          never_seen: number | null
          on_market: number | null
          property_type: string | null
          seen_le_3d: number | null
          seen_le_7d: number | null
          seen_today: number | null
          stale_gt_7d: number | null
        }
        Relationships: []
      }
      v_sweep_ingests: {
        Row: {
          counties: string | null
          industrial: number | null
          ingested_at: string | null
          items: number | null
          land: number | null
        }
        Relationships: []
      }
      v_sweep_runs_today: {
        Row: {
          county: string | null
          failed: number | null
          imported: number | null
          items: number | null
          last_error: string | null
          last_finished_at: string | null
          runs: number | null
          succeeded: number | null
          urls_expected: number | null
          urls_ok: number | null
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
            referencedRelation: "v_map_property"
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
      apply_ghl_tag: { Args: { p: Json }; Returns: Json }
      apply_ghl_tag_set: { Args: { p: Json }; Returns: Json }
      apply_land_decay: {
        Args: {
          p_acres: number
          p_beta: number
          p_max: number
          p_min: number
          p_typical: number
        }
        Returns: number
      }
      apply_smartlead_event: { Args: { p: Json }; Returns: Json }
      apply_zoning_map: { Args: never; Returns: Json }
      approve_buyer_intake: {
        Args: { p_client_id: string; p_intake_id: string }
        Returns: Json
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
      claim_text_sends: { Args: { p_limit?: number }; Returns: Json[] }
      client_area_match: {
        Args: { p_areas: Json; p_lat: number; p_lng: number }
        Returns: boolean
      }
      convert_prospect: {
        Args: {
          p_deal_type?: Database["public"]["Enums"]["deal_type"]
          p_prospect_id: string
          p_target: string
        }
        Returns: Json
      }
      cross_reference: { Args: { p_property_ids: string[] }; Returns: Json }
      derive_pursuit_deal_type: {
        Args: { p_client_id: string; p_property_id: string }
        Returns: Database["public"]["Enums"]["deal_type"]
      }
      dismiss_buyer_intake: {
        Args: { p_intake_id: string; p_reason?: string }
        Returns: Json
      }
      dor_class: { Args: { p_code: string }; Returns: number }
      email_audience_build: { Args: { p: Json }; Returns: Json }
      email_audience_property_merge: {
        Args: {
          p_ghl_acres: string
          p_ghl_addr: string
          p_ghl_city: string
          p_ghl_county: string
          p_ghl_sf: string
          p_ghl_state: string
          p_ghl_type: string
          p_ghl_zip: string
          p_prop_id: string
        }
        Returns: {
          building_sf: string
          city: string
          county: string
          land_acres: string
          property_address: string
          property_type: string
          state: string
          zip: string
        }[]
      }
      email_merge_fields: { Args: never; Returns: string[] }
      email_reply_is_autoreply: { Args: { p_text: string }; Returns: boolean }
      email_reply_is_bounce_notice: {
        Args: { p_text: string }
        Returns: boolean
      }
      email_reply_is_optout: { Args: { p_text: string }; Returns: boolean }
      email_reply_is_relayed: {
        Args: {
          p_cc: Json
          p_from_email: string
          p_subject: string
          p_target_email: string
          p_text: string
        }
        Returns: boolean
      }
      email_reply_significant_text: {
        Args: { p_body: string }
        Returns: string
      }
      email_template_unknown_fields: {
        Args: { p_steps: Json }
        Returns: string[]
      }
      enrich_electric: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_flood: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_gas: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_parcel_geometry: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_power_proximity: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_roads: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      enrich_sweep: {
        Args: { p_batch?: number; p_max_rounds?: number }
        Returns: Json
      }
      enrich_wetlands: {
        Args: { p_county: string; p_limit?: number }
        Returns: Json
      }
      ensure_payment_checks: { Args: never; Returns: Json }
      estimate_property_value: {
        Args: { p_exclude_comp_ids?: string[]; p_property_id: string }
        Returns: Json
      }
      execute_pursuit: {
        Args: { p?: Json; p_pursuit_id: string }
        Returns: Json
      }
      find_property: {
        Args: { p_address?: string; p_city?: string; p_parcel?: string }
        Returns: string
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
      ghl_history_note_payload: {
        Args: never
        Returns: {
          contact_id: string
          ghl_contact_id: string
          note_body: string
        }[]
      }
      ghl_touch_verified_contact: { Args: { p: Json }; Returns: string }
      ghl_verified_drift: { Args: { p: Json }; Returns: Json }
      ghl_verify_owner: { Args: { p: Json }; Returns: Json }
      import_county_building_data: { Args: { p: Json }; Returns: Json }
      import_county_lowlands: { Args: { p: Json }; Returns: Json }
      import_county_parcels: { Args: { p: Json }; Returns: Json }
      import_ghl_texts: { Args: { p: Json }; Returns: Json }
      import_gis_features: { Args: { p: Json }; Returns: Json }
      import_hubspot_batch: { Args: { p: Json }; Returns: Json }
      import_hubspot_engagements: {
        Args: { p_rows: Json }
        Returns: {
          inserted: number
          skipped_no_contact: number
          skipped_noise: number
        }[]
      }
      import_land_values: { Args: { p: Json }; Returns: Json }
      import_lease_comps: { Args: { p: Json }; Returns: Json }
      import_listing_spaces: { Args: { p: Json }; Returns: Json }
      import_market_events: { Args: { p: Json }; Returns: Json }
      import_outreach_targets: { Args: { p: Json }; Returns: Json }
      import_owner_addresses: { Args: { p: Json }; Returns: Json }
      import_parcel_enrichment: { Args: { p: Json }; Returns: Json }
      import_parcel_geoms: { Args: { p: Json }; Returns: Json }
      import_scraped_listings: {
        Args: { p_client_id?: string; p_flagged_new?: boolean; p_props: Json }
        Returns: Json
      }
      import_situs_addresses: { Args: { p: Json }; Returns: Json }
      import_terrakotta_batch: { Args: { p: Json }; Returns: Json }
      import_usable_acres: {
        Args: { p: Json; p_area_tolerance?: number }
        Returns: Json
      }
      import_zoning: { Args: { p: Json }; Returns: Json }
      ingest_blooio_event: { Args: { p: Json }; Returns: Json }
      ingest_scrub_result: { Args: { p: Json }; Returns: Json }
      intake_buyer_tag: { Args: { p: Json }; Returns: Json }
      intake_client: { Args: { p: Json; p_owner: string }; Returns: Json }
      intake_landlord_listing: {
        Args: { p: Json; p_owner: string }
        Returns: Json
      }
      intake_prospect: { Args: { p: Json; p_owner: string }; Returns: Json }
      is_va: { Args: never; Returns: boolean }
      kick_deal_flag_evals: { Args: never; Returns: string }
      kick_market_refresh: { Args: never; Returns: string }
      listing_space_targets: {
        Args: { p_limit?: number }
        Returns: {
          listing_id: string
          source_listing_id: string
          url: string
        }[]
      }
      map_properties: {
        Args: {
          p_book?: string
          p_limit?: number
          p_max_lat: number
          p_max_lng: number
          p_min_lat: number
          p_min_lng: number
        }
        Returns: {
          owner_ctx: Json
          property: Json
          total_in_view: number
        }[]
      }
      mark_contact_as_buyer: { Args: { p_contact_id: string }; Returns: Json }
      mark_owners_exported: {
        Args: { p_property_ids: string[] }
        Returns: Json
      }
      market_event_alerts: {
        Args: { p_limit?: number }
        Returns: {
          address: string
          city: string
          contact_name: string
          contact_phone: string
          event_date: string
          event_id: string
          event_type: Database["public"]["Enums"]["market_event_type"]
          first_seen_at: string
          owner_name: string
          property_id: string
          title: string
          url: string
        }[]
      }
      market_monitor_health: { Args: never; Returns: Json }
      name_has_all_tokens: {
        Args: { p_n: number; p_text: string; p_tokens: string[] }
        Returns: boolean
      }
      normalize_address_text: { Args: { p_text: string }; Returns: string }
      normalize_lease_structure: {
        Args: { p: string }
        Returns: Database["public"]["Enums"]["lease_structure"]
      }
      normalize_mail_address: { Args: { p: string }; Returns: string }
      normalize_owner_name: { Args: { p_name: string }; Returns: string }
      normalize_parcel: { Args: { p: string }; Returns: string }
      normalize_phone: { Args: { p: string }; Returns: string }
      normalize_street: { Args: { p_addr: string }; Returns: string }
      normalize_street_loose: { Args: { p_addr: string }; Returns: string }
      outreach_audience: { Args: { p: Json }; Returns: Json }
      outreach_call_audience: { Args: { p: Json }; Returns: Json }
      outreach_ghl_mark: { Args: { p: Json }; Returns: Json }
      outreach_ghl_push_rows: { Args: { p_list: string }; Returns: Json }
      outreach_list_suppressed: { Args: { p_list: string }; Returns: Json }
      outreach_mail_audience: { Args: { p: Json }; Returns: Json }
      outreach_mark_wrong_number: { Args: { p: Json }; Returns: Json }
      phone_e164: { Args: { p: string }; Returns: string }
      phone_is_suppressed: { Args: { p_phone: string }; Returns: boolean }
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
      property_last_sales: { Args: never; Returns: Json }
      recent_touches: { Args: { p_phone: string }; Returns: number }
      record_market_listings_for_known: {
        Args: { p_rows: Json }
        Returns: Json
      }
      record_text_send_result: { Args: { p: Json }; Returns: Json }
      refresh_condo_units: { Args: never; Returns: number }
      refresh_county_market_stats: { Args: never; Returns: number }
      refresh_derived_property_tags: { Args: never; Returns: Json }
      refresh_land_book: { Args: never; Returns: Json }
      refresh_powered_sites: { Args: never; Returns: Json }
      refresh_property_market_position: { Args: never; Returns: number }
      refresh_property_owner_rollup: { Args: never; Returns: number }
      refresh_suggestions: { Args: { p_days?: number }; Returns: Json }
      run_deal_flag_evals: { Args: { p_limit?: number }; Returns: Json }
      score_parcels: {
        Args: { p_county?: string; p_limit?: number; p_min_coverage?: number }
        Returns: Json
      }
      scrub_candidates: { Args: { p_limit?: number }; Returns: Json[] }
      search_contacts: {
        Args: {
          p_include_archived?: boolean
          p_limit?: number
          p_query: string
        }
        Returns: {
          archived: boolean
          company_id: string
          company_name: string
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          phone: string
          title: string
          updated_at: string
        }[]
      }
      search_map_properties: {
        Args: { p_book?: string; p_limit?: number; p_query: string }
        Returns: {
          owner_ctx: Json
          property: Json
          total_in_view: number
        }[]
      }
      search_properties: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          address: string
          city: string
          county: string
          folio: string
          id: string
          parcel_number: string
          source_address: string
          state: string
          zip: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      strip_html: { Args: { p: string }; Returns: string }
      suggest_properties: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          address: string
          city: string
          county: string
          id: string
        }[]
      }
      suggest_properties_to_client: {
        Args: { p_client_id: string; p_property_ids: string[] }
        Returns: Json
      }
      sweep_finalize_off_market: {
        Args: { p_counties?: string[]; p_fresh_within_days?: number }
        Returns: Json
      }
      sweep_log_run:
        | {
            Args: {
              p_actor_id?: string
              p_county?: string
              p_deal_type?: string
              p_error?: string
              p_finished_at?: string
              p_imported?: number
              p_item_count?: number
              p_property_type?: string
              p_run_id: string
              p_source?: string
              p_start_url?: string
              p_started_at?: string
              p_status: string
            }
            Returns: string
          }
        | {
            Args: {
              p_actor_id?: string
              p_county?: string
              p_deal_type?: string
              p_error?: string
              p_finished_at?: string
              p_imported?: number
              p_item_count?: number
              p_property_type?: string
              p_run_id: string
              p_source?: string
              p_start_url?: string
              p_started_at?: string
              p_status: string
              p_urls_expected?: number
              p_urls_ok?: number
            }
            Returns: string
          }
      sweep_mark_off_market: {
        Args: { p_seen_property_ids: string[] }
        Returns: Json
      }
      sweep_stamp_seen: {
        Args: { p_seen_property_ids: string[] }
        Returns: Json
      }
      texting_quiet_ok: { Args: { p_phone: string }; Returns: boolean }
      texting_send_allowed: {
        Args: { p_is_reply: boolean; p_phone: string }
        Returns: Json
      }
      unverify_contact: { Args: { p: Json }; Returns: Json }
      va_approve_send: { Args: { p_send_id: string }; Returns: Json }
      va_confirm_owner: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_phone: string
          p_target_id: string
        }
        Returns: string
      }
      va_guard_pre_request: { Args: never; Returns: undefined }
      va_not_interested: { Args: { p_phone: string }; Returns: Json }
      va_send_reply: {
        Args: { p_body: string; p_phone: string }
        Returns: string
      }
      va_thread_context: { Args: { p_phone: string }; Returns: Json }
      va_wrong_person: { Args: { p_phone: string }; Returns: Json }
      warroom_counts: {
        Args: { p_filters: Json }
        Returns: {
          condo_hidden: number
          total: number
        }[]
      }
      warroom_ids: {
        Args: { p_cap?: number; p_filters: Json }
        Returns: {
          id: string
        }[]
      }
      warroom_page:
        | {
            Args: { p_filters: Json; p_limit?: number; p_offset?: number }
            Returns: {
              owner_ctx: Json
              property: Json
            }[]
          }
        | {
            Args: {
              p_filters: Json
              p_limit?: number
              p_offset?: number
              p_ordered?: boolean
            }
            Returns: {
              owner_ctx: Json
              property: Json
            }[]
          }
      warroom_predicate: { Args: { p_filters: Json }; Returns: Json }
      weighted_percentile: {
        Args: { p_p: number; p_vals: number[]; p_wts: number[] }
        Returns: number
      }
    }
    Enums: {
      buyer_intake_status: "pending" | "approved" | "dismissed"
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
        | "archived"
      comm_channel: "call" | "sms" | "email" | "note" | "meeting" | "other"
      comm_direction: "inbound" | "outbound" | "unknown"
      comm_source:
        | "hubspot"
        | "terrakotta"
        | "smartercontact"
        | "ghl"
        | "manual"
        | "smartlead"
      comp_kind: "asking" | "executed" | "transfer"
      company_type:
        | "landlord"
        | "tenant"
        | "broker"
        | "other"
        | "vendor"
        | "owning_entity"
      contact_category:
        | "landlord"
        | "owning_entity"
        | "tenant"
        | "broker"
        | "vendor"
        | "other"
      deal_flag_status: "pending" | "dismissed" | "expired"
      deal_radar_source: "marketplace" | "group"
      deal_radar_status:
        | "new"
        | "messaged"
        | "replied"
        | "negotiating"
        | "dead"
        | "converted"
      deal_radar_type: "industrial" | "land"
      deal_type: "lease" | "sale" | "both"
      email_campaign_purpose:
        | "off_market_seller"
        | "buyer_list"
        | "listing_to_nearby"
        | "space_seeker"
        | "expiring_lease"
        | "general"
      email_deliverability:
        | "valid"
        | "catch_all"
        | "unknown"
        | "invalid"
        | "spamtrap"
        | "abuse"
        | "do_not_mail"
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
        | "self_storage"
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
      market_event_status: "new" | "seen" | "dismissed"
      market_event_type: "permit" | "sale" | "zoning_change"
      msg_direction: "inbound" | "outbound"
      msg_protocol: "imessage" | "sms" | "rcs" | "unknown"
      note_kind: "note" | "call" | "text" | "email" | "meeting" | "tour"
      owner_kind: "individual" | "entity" | "government" | "unknown"
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
      suppression_reason:
        | "federal_dnc"
        | "state_dnc"
        | "litigator"
        | "wrong_person"
        | "opt_out"
        | "hostile"
        | "carrier_block"
        | "said_no"
        | "manual"
      task_kind: "renewal" | "follow_up" | "general" | "tour"
      task_status: "open" | "done"
      text_send_status:
        | "draft"
        | "approved"
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "failed"
        | "blocked"
      triage_label:
        | "owner_yes"
        | "wrong_person"
        | "not_interested"
        | "opt_out"
        | "hostile_legal"
        | "question"
        | "autoreply"
        | "unknown"
      zoning_kind:
        | "industrial"
        | "office"
        | "retail"
        | "multifamily"
        | "residential"
        | "agricultural"
        | "mixed_use"
        | "planned_development"
        | "other"
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
      buyer_intake_status: ["pending", "approved", "dismissed"],
      buyer_kind: ["investor", "owner_user", "developer"],
      client_purpose: [
        "expansion",
        "first_location",
        "relocation",
        "investment",
      ],
      client_status: [
        "prospect",
        "searching",
        "negotiating",
        "closed",
        "lost",
        "archived",
      ],
      comm_channel: ["call", "sms", "email", "note", "meeting", "other"],
      comm_direction: ["inbound", "outbound", "unknown"],
      comm_source: [
        "hubspot",
        "terrakotta",
        "smartercontact",
        "ghl",
        "manual",
        "smartlead",
      ],
      comp_kind: ["asking", "executed", "transfer"],
      company_type: [
        "landlord",
        "tenant",
        "broker",
        "other",
        "vendor",
        "owning_entity",
      ],
      contact_category: [
        "landlord",
        "owning_entity",
        "tenant",
        "broker",
        "vendor",
        "other",
      ],
      deal_flag_status: ["pending", "dismissed", "expired"],
      deal_radar_source: ["marketplace", "group"],
      deal_radar_status: [
        "new",
        "messaged",
        "replied",
        "negotiating",
        "dead",
        "converted",
      ],
      deal_radar_type: ["industrial", "land"],
      deal_type: ["lease", "sale", "both"],
      email_campaign_purpose: [
        "off_market_seller",
        "buyer_list",
        "listing_to_nearby",
        "space_seeker",
        "expiring_lease",
        "general",
      ],
      email_deliverability: [
        "valid",
        "catch_all",
        "unknown",
        "invalid",
        "spamtrap",
        "abuse",
        "do_not_mail",
      ],
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
        "self_storage",
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
      market_event_status: ["new", "seen", "dismissed"],
      market_event_type: ["permit", "sale", "zoning_change"],
      msg_direction: ["inbound", "outbound"],
      msg_protocol: ["imessage", "sms", "rcs", "unknown"],
      note_kind: ["note", "call", "text", "email", "meeting", "tour"],
      owner_kind: ["individual", "entity", "government", "unknown"],
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
      suppression_reason: [
        "federal_dnc",
        "state_dnc",
        "litigator",
        "wrong_person",
        "opt_out",
        "hostile",
        "carrier_block",
        "said_no",
        "manual",
      ],
      task_kind: ["renewal", "follow_up", "general", "tour"],
      task_status: ["open", "done"],
      text_send_status: [
        "draft",
        "approved",
        "queued",
        "sending",
        "sent",
        "delivered",
        "failed",
        "blocked",
      ],
      triage_label: [
        "owner_yes",
        "wrong_person",
        "not_interested",
        "opt_out",
        "hostile_legal",
        "question",
        "autoreply",
        "unknown",
      ],
      zoning_kind: [
        "industrial",
        "office",
        "retail",
        "multifamily",
        "residential",
        "agricultural",
        "mixed_use",
        "planned_development",
        "other",
      ],
    },
  },
} as const
