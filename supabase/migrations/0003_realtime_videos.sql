-- Réelgram — active le realtime sur public.videos
-- Spec/debug: la bibliothèque ne se mettait pas à jour en live (carte
-- d'ingestion figée sur « Sans titre » + « … » jusqu'au relaunch de l'app).
--
-- Cause racine : les events `postgres_changes` ne sont émis QUE pour les tables
-- membres de la publication `supabase_realtime` (vide par défaut). `videos`
-- n'y avait jamais été ajoutée → la souscription `subscribeVideos()` (db.ts)
-- ne recevait jamais rien. `listVideos()` (requête normale) marchait, d'où le
-- fait que fermer/rouvrir l'app (refetch) « corrigeait » l'affichage.
--
-- Idempotent : ne ré-ajoute pas la table si elle est déjà membre.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'videos'
  ) then
    alter publication supabase_realtime add table public.videos;
  end if;
end $$;
