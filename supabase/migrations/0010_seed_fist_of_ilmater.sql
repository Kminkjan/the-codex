-- Second campaign so the picker has something to switch to (issue #18).
-- Content import from the play notes is issue #20.
insert into public.campaigns (id, title, subtitle) values
  ('fist-of-ilmater', 'Fist of Ilmater', 'From Mirabar to the Dollmother''s web')
on conflict (id) do nothing;
