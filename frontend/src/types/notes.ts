export interface OpenTab {
  id: string;        // doc_id or temp UUID for new notes
  title: string;
  content: string;
  isNew: boolean;
  isLoading?: boolean;
  closable?: boolean; // defaults to true; set false for permanent tabs like Brain
}
