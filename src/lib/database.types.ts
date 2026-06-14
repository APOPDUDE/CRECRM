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
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          notes: string | null
          phone: string | null
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
      files: {
        Row: {
          category: Database["public"]["Enums"]["file_category"]
          contact_id: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["note_entity"]
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["file_category"]
          contact_id?: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["note_entity"]
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["file_category"]
          contact_id?: string | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["note_entity"]
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_comps: {
        Row: {
          asking_lease_rate_psf: number | null
          commencement_date: string | null
          created_at: string
          escalations: string | null
          executed_at: string | null
          executed_lease_rate_psf: number | null
          expiration_date: string | null
          free_rent_months: number | null
          id: string
          lease_type: Database["public"]["Enums"]["lease_structure"] | null
          match_id: string | null
          notes: string | null
          owner_id: string | null
          property_id: string
          sf: number | null
          source: string
          source_listing_id: string | null
          tenant_company_id: string | null
          term_months: number | null
          ti_psf: number | null
          updated_at: string
        }
        Insert: {
          asking_lease_rate_psf?: number | null
          commencement_date?: string | null
          created_at?: string
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          lease_type?: Database["public"]["Enums"]["lease_structure"] | null
          match_id?: string | null
          notes?: string | null
          owner_id?: string | null
          property_id: string
          sf?: number | null
          source?: string
          source_listing_id?: string | null
          tenant_company_id?: string | null
          term_months?: number | null
          ti_psf?: number | null
          updated_at?: string
        }
        Update: {
          asking_lease_rate_psf?: number | null
          commencement_date?: string | null
          created_at?: string
          escalations?: string | null
          executed_at?: string | null
          executed_lease_rate_psf?: number | null
          expiration_date?: string | null
          free_rent_months?: number | null
          id?: string
          lease_type?: Database["public"]["Enums"]["lease_structure"] | null
          match_id?: string | null
          notes?: string | null
          owner_id?: string | null
          property_id?: string
          sf?: number | null
          source?: string
          source_listing_id?: string | null
          tenant_company_id?: string | null
          term_months?: number | null
          ti_psf?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lease_comps_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lease_comps_tenant_company_id_fkey"
            columns: ["tenant_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          listing_expiration: string | null
          lost_reason: string | null
          next_action_date: string | null
          next_action_description: string | null
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
          listing_expiration?: string | null
          lost_reason?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
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
          listing_expiration?: string | null
          lost_reason?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
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
      matches: {
        Row: {
          broker_contact_id: string | null
          closing_date: string | null
          commencement_date: string | null
          created_at: string
          dd_expiration_date: string | null
          execution_date: string | null
          flagged_new: boolean
          tour_at: string | null
          loi_date: string | null
          lease_negotiation_date: string | null
          executed_rate_psf: number | null
          executed_price: number | null
          lease_structure: Database["public"]["Enums"]["lease_structure"] | null
          escalations: string | null
          ti_psf: number | null
          term_months: number | null
          free_rent_months: number | null
          id: string
          inquiry_date: string
          lease_expiration: string | null
          lease_renewal_date: string | null
          listing_id: string | null
          notes: string | null
          property_id: string
          psa_execution_date: string | null
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["match_stage"]
          tenant_company_id: string | null
          tenant_contact_id: string | null
          tenant_rep_id: string | null
          tour_date: string | null
          updated_at: string
        }
        Insert: {
          broker_contact_id?: string | null
          closing_date?: string | null
          commencement_date?: string | null
          created_at?: string
          dd_expiration_date?: string | null
          execution_date?: string | null
          flagged_new?: boolean
          tour_at?: string | null
          loi_date?: string | null
          lease_negotiation_date?: string | null
          executed_rate_psf?: number | null
          executed_price?: number | null
          lease_structure?: Database["public"]["Enums"]["lease_structure"] | null
          escalations?: string | null
          ti_psf?: number | null
          term_months?: number | null
          free_rent_months?: number | null
          id?: string
          inquiry_date?: string
          lease_expiration?: string | null
          lease_renewal_date?: string | null
          listing_id?: string | null
          notes?: string | null
          property_id: string
          psa_execution_date?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["match_stage"]
          tenant_company_id?: string | null
          tenant_contact_id?: string | null
          tenant_rep_id?: string | null
          tour_date?: string | null
          updated_at?: string
        }
        Update: {
          broker_contact_id?: string | null
          closing_date?: string | null
          commencement_date?: string | null
          created_at?: string
          dd_expiration_date?: string | null
          execution_date?: string | null
          flagged_new?: boolean
          tour_at?: string | null
          loi_date?: string | null
          lease_negotiation_date?: string | null
          executed_rate_psf?: number | null
          executed_price?: number | null
          lease_structure?: Database["public"]["Enums"]["lease_structure"] | null
          escalations?: string | null
          ti_psf?: number | null
          term_months?: number | null
          free_rent_months?: number | null
          id?: string
          inquiry_date?: string
          lease_expiration?: string | null
          lease_renewal_date?: string | null
          listing_id?: string | null
          notes?: string | null
          property_id?: string
          psa_execution_date?: string | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["match_stage"]
          tenant_company_id?: string | null
          tenant_contact_id?: string | null
          tenant_rep_id?: string | null
          tour_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_broker_contact_id_fkey"
            columns: ["broker_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tenant_company_id_fkey"
            columns: ["tenant_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tenant_contact_id_fkey"
            columns: ["tenant_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tenant_rep_id_fkey"
            columns: ["tenant_rep_id"]
            isOneToOne: false
            referencedRelation: "tenant_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          contact_id: string | null
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["note_entity"]
          id: string
          kind: Database["public"]["Enums"]["note_kind"]
        }
        Insert: {
          body: string
          contact_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["note_entity"]
          id?: string
          kind?: Database["public"]["Enums"]["note_kind"]
        }
        Update: {
          body?: string
          contact_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["note_entity"]
          id?: string
          kind?: Database["public"]["Enums"]["note_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          asking_price: number | null
          asking_rate_psf: number | null
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          building_sf: number | null
          cap_rate_pct: number | null
          city: string | null
          created_at: string
          days_on_market: number | null
          id: string
          land_acres: number | null
          lat: number | null
          listed_at: string | null
          lng: number | null
          listing_url: string | null
          photo_urls: string[] | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          scraped_at: string | null
          source: string | null
          source_listing_id: string | null
          source_url: string | null
          specs: string | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address: string
          asking_price?: number | null
          asking_rate_psf?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_sf?: number | null
          cap_rate_pct?: number | null
          city?: string | null
          created_at?: string
          days_on_market?: number | null
          id?: string
          land_acres?: number | null
          lat?: number | null
          listed_at?: string | null
          listing_url?: string | null
          lng?: number | null
          photo_urls?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          scraped_at?: string | null
          source?: string | null
          source_listing_id?: string | null
          source_url?: string | null
          specs?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string
          asking_price?: number | null
          asking_rate_psf?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          building_sf?: number | null
          cap_rate_pct?: number | null
          city?: string | null
          created_at?: string
          days_on_market?: number | null
          id?: string
          land_acres?: number | null
          lat?: number | null
          listed_at?: string | null
          listing_url?: string | null
          lng?: number | null
          photo_urls?: string[] | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          scraped_at?: string | null
          source?: string | null
          source_listing_id?: string | null
          source_url?: string | null
          specs?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          auto_generated: boolean
          completed_at: string | null
          contact_id: string | null
          created_at: string
          details: string | null
          due_date: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["note_entity"] | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          match_id: string | null
          owner_id: string
          source: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["note_entity"] | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          match_id?: string | null
          owner_id: string
          source?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["note_entity"] | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          match_id?: string | null
          owner_id?: string
          source?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_reps: {
        Row: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          clear_height: string | null
          commission_pct: number | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          created_at: string
          estimated_fee: number | null
          id: string
          loading_type: string | null
          lost_reason: string | null
          move_in_context: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action_date: string | null
          next_action_description: string | null
          office_sf_max: number | null
          office_sf_min: number | null
          outdoor_storage_max_ac: number | null
          outdoor_storage_min_ac: number | null
          owner_id: string
          power_requirements: string | null
          probability_pct: number | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["tenant_rep_stage"]
          status: Database["public"]["Enums"]["engagement_status"]
          target_area: string | null
          tenant_company_id: string | null
          tenant_contact_id: string | null
          updated_at: string
          warehouse_sf_max: number | null
          warehouse_sf_min: number | null
        }
        Insert: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          clear_height?: string | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          commission_pct?: number | null
          created_at?: string
          estimated_fee?: number | null
          id?: string
          loading_type?: string | null
          lost_reason?: string | null
          move_in_context?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
          office_sf_max?: number | null
          office_sf_min?: number | null
          outdoor_storage_max_ac?: number | null
          outdoor_storage_min_ac?: number | null
          owner_id: string
          power_requirements?: string | null
          probability_pct?: number | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["tenant_rep_stage"]
          status?: Database["public"]["Enums"]["engagement_status"]
          target_area?: string | null
          tenant_company_id?: string | null
          tenant_contact_id?: string | null
          updated_at?: string
          warehouse_sf_max?: number | null
          warehouse_sf_min?: number | null
        }
        Update: {
          actual_fee?: number | null
          broker_contact_id?: string | null
          budget?: string | null
          clear_height?: string | null
          deal_type?: Database["public"]["Enums"]["deal_type"]
          commission_pct?: number | null
          created_at?: string
          estimated_fee?: number | null
          id?: string
          loading_type?: string | null
          lost_reason?: string | null
          move_in_context?: string | null
          move_in_date?: string | null
          must_haves?: string | null
          next_action_date?: string | null
          next_action_description?: string | null
          office_sf_max?: number | null
          office_sf_min?: number | null
          outdoor_storage_max_ac?: number | null
          outdoor_storage_min_ac?: number | null
          owner_id?: string
          power_requirements?: string | null
          probability_pct?: number | null
          property_type?: Database["public"]["Enums"]["property_kind"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          stage?: Database["public"]["Enums"]["tenant_rep_stage"]
          status?: Database["public"]["Enums"]["engagement_status"]
          target_area?: string | null
          tenant_company_id?: string | null
          tenant_contact_id?: string | null
          updated_at?: string
          warehouse_sf_max?: number | null
          warehouse_sf_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_reps_broker_contact_id_fkey"
            columns: ["broker_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_reps_tenant_company_id_fkey"
            columns: ["tenant_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_reps_tenant_contact_id_fkey"
            columns: ["tenant_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_property_and_listing: {
        Args: {
          p_address: string
          p_asking_price?: number
          p_asking_rate_psf?: number
          p_city?: string
          p_deal_type: Database["public"]["Enums"]["deal_type"]
          p_landlord_company_id?: string
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
          listing_expiration: string | null
          lost_reason: string | null
          next_action_date: string | null
          next_action_description: string | null
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
      import_scraped_listings: {
        Args: {
          p_flagged_new?: boolean
          p_props: Json
          p_tenant_rep_id?: string
        }
        Returns: Json
      }
      promote_match_to_tenant_rep: {
        Args: { p_match_id: string; p_owner: string }
        Returns: {
          actual_fee: number | null
          broker_contact_id: string | null
          budget: string | null
          clear_height: string | null
          commission_pct: number | null
          deal_type: Database["public"]["Enums"]["deal_type"]
          created_at: string
          estimated_fee: number | null
          id: string
          loading_type: string | null
          lost_reason: string | null
          move_in_context: string | null
          move_in_date: string | null
          must_haves: string | null
          next_action_date: string | null
          next_action_description: string | null
          office_sf_max: number | null
          office_sf_min: number | null
          outdoor_storage_max_ac: number | null
          outdoor_storage_min_ac: number | null
          owner_id: string
          power_requirements: string | null
          probability_pct: number | null
          property_type: Database["public"]["Enums"]["property_kind"] | null
          source: Database["public"]["Enums"]["lead_source"] | null
          stage: Database["public"]["Enums"]["tenant_rep_stage"]
          status: Database["public"]["Enums"]["engagement_status"]
          target_area: string | null
          tenant_company_id: string | null
          tenant_contact_id: string | null
          updated_at: string
          warehouse_sf_max: number | null
          warehouse_sf_min: number | null
        }
        SetofOptions: {
          from: "*"
          to: "tenant_reps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      company_type: "landlord" | "tenant" | "broker" | "other"
      deal_type: "lease" | "sale"
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
      listing_stage: "proposal" | "listed" | "closed"
      match_stage:
        | "inquiring"
        | "lead"
        | "toured"
        | "loi"
        | "lease_negotiation"
        | "executed"
        | "dead"
      note_entity: "listing" | "tenant_rep" | "match"
      note_kind: "note" | "call" | "text" | "email" | "meeting"
      property_kind:
        | "industrial"
        | "office"
        | "retail"
        | "flex"
        | "land"
        | "other"
      task_kind: "renewal" | "follow_up" | "general"
      task_status: "open" | "done"
      tenant_rep_stage:
        | "lead"
        | "touring"
        | "loi"
        | "lease_negotiation"
        | "executed"
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
      company_type: ["landlord", "tenant", "broker", "other"],
      deal_type: ["lease", "sale"],
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
      listing_stage: ["proposal", "listed", "closed"],
      match_stage: [
        "inquiring",
        "lead",
        "toured",
        "loi",
        "lease_negotiation",
        "executed",
        "dead",
      ],
      note_entity: ["listing", "tenant_rep", "match"],
      note_kind: ["note", "call", "text", "email", "meeting"],
      property_kind: [
        "industrial",
        "office",
        "retail",
        "flex",
        "land",
        "other",
      ],
      task_kind: ["renewal", "follow_up", "general"],
      task_status: ["open", "done"],
      tenant_rep_stage: [
        "lead",
        "touring",
        "loi",
        "lease_negotiation",
        "executed",
      ],
    },
  },
} as const
