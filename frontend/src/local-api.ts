import { request } from './api';

export type FarmLocation = { name: string; latitude: number; longitude: number; source: 'gps' | 'manual'; accuracy?: number | null };
export type ListingKind = 'tool' | 'job' | 'worker';
export type Listing = {
  id: string; kind: ListingKind; title: string; category: string; description: string; daily_rate: number;
  location_name: string; start_date: string; end_date: string; people: number; owner_name: string;
  status: 'open' | 'closed'; created_at: string; is_owner: boolean; distance_km?: number | null;
  request_count: number; phone?: string | null; my_request?: { id: string; status: string } | null;
};
export type ListingInput = Pick<Listing, 'kind' | 'title' | 'category' | 'description' | 'daily_rate' | 'location_name' | 'start_date' | 'end_date' | 'people'> & { latitude: number; longitude: number; phone: string };
export type MarketActivity = {
  id: string; listing_id: string; title: string; kind: ListingKind; incoming: boolean; other_name: string;
  status: string; start_date: string; end_date: string; total: number; message: string; phone?: string | null; created_at: string;
};
export const jsonBody = (data: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const getLocation = () => request<FarmLocation | null>('/location');
export const saveLocation = (data: FarmLocation) => request<FarmLocation>('/location', jsonBody(data, 'PUT'));
export const searchLocations = (q: string) => request<(FarmLocation & {id: string})[]>(`/locations/search?q=${encodeURIComponent(q)}`);
export const createListing = (data: ListingInput) => request<Listing>('/market/listings', jsonBody(data));
export const getListings = (params: Record<string, string | number | boolean>) => request<Listing[]>(`/market/listings?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`);
export const getListing = (id: string) => request<Listing>(`/market/listings/${id}`);
export const setListingStatus = (id: string, status: 'open' | 'closed') => request<Listing>(`/market/listings/${id}`, jsonBody({status}, 'PATCH'));
export const respondToListing = (id: string, data: {phone: string; message: string; start_date: string; end_date: string}) => request<Listing>(`/market/listings/${id}/requests`, jsonBody(data));
export const getActivity = (board: 'tools' | 'work') => request<MarketActivity[]>(`/market/activity?board=${board}`);
export const decideResponse = (listingId: string, id: string, status: string) => request<Listing>(`/market/listings/${listingId}/requests/${id}`, jsonBody({status}, 'PATCH'));