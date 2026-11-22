import { redirect } from 'next/navigation';
import catalog from '../../scripts/projection-cabinet/data/catalog.json';
import routes from '../../scripts/projection-cabinet/data/routes.json';

type Params = Record<string, string | string[] | undefined>;

/** Preserve bookmarked studio links while new visitors open the static document directly. */
export default async function StudioPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const get = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  const edition = get('embed') === 'lounge' ? 'site' : 'site-web';
  const document = '/projection-cabinet/' + edition + '/index.html' + (get('proof') !== undefined ? '?proof' : '');
  const view = get('view');
  if (view === 'studio') redirect(document + '#ui/studio');
  if (view === 'brief') redirect(document + '#ui/brief/format');
  if (!view && !get('f') && !get('i') && !get('axis')) redirect(document);

  const format = (catalog.formats[Number(get('f')) - 1] ?? catalog.formats[0]).id;
  const industry = (catalog.industries[Number(get('i')) - 1] ?? catalog.industries[2]).id;
  const film = catalog.films.find(item => item.formatId === format && item.industryId === industry)!;
  if (view === 'case' && routes.some(route => route.id === 'study/' + film.slug)) redirect(document + '#ui/study/' + film.slug);
  if (view === 'theater') redirect(document + '#ui/view/' + film.slug);
  if (get('axis') === 'industry' && (!view || view === 'browse')) redirect(document + '#ui/industry/' + industry);
  redirect(document + '#ui/film/' + film.slug);
}
