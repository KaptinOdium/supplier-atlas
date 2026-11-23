"""Build Atlas's public discovery feed. No supplier register is an input."""
import argparse
import hashlib
import html
import io
import json
import os
import re
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from calendar import monthrange
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UTC = timezone.utc
HORIZON = timedelta(hours=72)
GDELT = 'https://data.gdeltproject.org/gdeltv2/'
UK_RECALLS = 'https://www.gov.uk/api/search.json?' + urlencode({
    'filter_content_store_document_type': 'product_safety_alert_report_recall',
    'order': '-public_timestamp', 'fields': 'title,link,public_timestamp', 'count': 100,
})
CA_RECALLS = 'https://wwwapps.tc.gc.ca/saf-sec-sur/7/vrdb-bdrv/search-recherche/rss.aspx?lang=eng'
GAZETTE = 'https://www.thegazette.co.uk/all-notices/notice/data.feed?noticetypes=2410&results-page-size=100'
SOURCES = {
    'gdelt': ('GDELT world news index', 'https://www.gdeltproject.org/data.html'),
    'uk-opss': ('UK Office for Product Safety and Standards', 'https://www.gov.uk/product-safety-alerts-reports-recalls'),
    'ca-transport': ('Transport Canada vehicle recalls', 'https://recalls-rappels.canada.ca/en/rss-feeds'),
    'uk-gazette': ('The Gazette · corporate administration', 'https://www.thegazette.co.uk/all-notices/notice?noticetypes=2410'),
}
NETWORK_ERRORS = (OSError, URLError, ValueError, KeyError, zipfile.BadZipFile, ElementTree.ParseError)
RECORD_ERRORS = NETWORK_ERRORS + (IndexError,)

# Require an incident or a specific decision affecting operations. Broad words
# such as "risk", "security", "strike" (sports/military), and "loss" are noisy.
INDUSTRY = re.compile(r'\b(?:auto(?:maker|motive)|manufactur\w*|industr\w*|steel\w*|factory|factories|plant|mine|refiner\w*|semiconductor|chipmaker|smelter|assembly|production|chemic\w*|pipeline|electricity|power|warehouse|facilit\w*|terminal|workers?|union|port|freight|cargo|rail\w*|carrier|shipping|trucking|airport|airline|shipyard|supplier|company|firm|group|operations)\b', re.I)
PATTERNS = {
    'cyber': r'\b(?:cyber[ -]?(?:attack|incident)|ransomware|IT outage|system(?:s)? outage)\b',
    'labor': r'\b(?:workers? (?:go on |to |launch |begin |start |extend |plan |continue |stage )?(?:a |an |indefinite )?strike|walkout|industrial action|workers? (?:strike|walk off)|(?:union|port|rail|factory|dock|cargo|pilot|truck|bus|airline|workforce|airport)\w* strike|strike (?:hits|halts|disrupts|shuts|at)|strike notice|work stoppage|lockout|picket line)\b',
    'production': r'\b(?:force majeure|(?:plant|factory|facility|mill|refinery|plant floor|warehouse|mine|smelter|chemical plant) (?:fire|explosion|shutdown|closure|closes|outage)|(?:fire|explosion) (?:hits|shuts|halts|at|breaks out at|damages|engulfs)\b|(?:halt\w*|stop\w*|suspend\w*|paus\w*|cut\w*|ceas\w*|disrupt\w*|curtail\w*) (?:all |its |vehicle |car |steel |oil |gas |factory |plant |local )?(?:production|manufacturing|output|operations)|(?:production|operations) (?:halt\w*|suspend\w*|shutdown|disrupt\w*|stoppage)|(?:clos\w*|shut\w*) (?:its |down |the |a |assembly |steel |vehicle |car ){0,3}(?:plant|factory|mill|refinery)|power outage)\b',
    'logistics': r'\b(?:(?:port|terminal|railway|rail|railroad|freight|cargo|shipping|supply chain|airport|pipeline|border|deliveries|shipments|service) (?:closure|disrupt\w*|shutdown|outage|suspension|suspend\w*|halt\w*|blockade|congestion|delay\w*|closed)|(?:suspend\w*|halt\w*|disrupt\w*|delay\w*|block\w*|reroute\w*) (?:freight|rail|shipping|shipments|cargo|deliveries|traffic at)|freight train derailment|port of .{2,40}(?:closed|suspend\w*|halt\w*)|(?:canal|strait|shipping lane) (?:closure|closed|blockade|blocked))\b',
    'financial': r'\b(?:files? for (?:chapter 11|bankruptcy|insolvency|administration)|filed for (?:chapter 11|bankruptcy|insolvency)|enter(?:s|ed)? (?:into )?(?:insolvency|administration|liquidation|receivership)|declares? bankruptcy|bankruptcy filing|goes into liquidation|placed (?:into|in) administration|appoints? administrators?)\b',
    'quality': r'\b(?:recalls? (?:over|nearly|more than|about|certain|vehicles|trucks|cars|parts|tires|batteries|chargers|thousands|millions|hundreds|[\d,]+)|stop[ -]sale|safety recall|product recall|recall (?:over|due to|issued for|affects)|issues? (?:a )?recall)\b',
}
PATTERNS = {key: re.compile(expr, re.I) for key, expr in PATTERNS.items()}
NOISE = re.compile(r'\b(?:video game|stock market today|fantasy football|football|baseball|box office|anniversary|years? (?:on|after)|century later|memorializ\w*|opinion|editorial|how to|simulation|tabletop exercise|cyberattack drill|mock drill|war game|trailer|strike price|air strike|airstrike|missile strike|emergency rooms?|patients?|vaccines?|graduate students?|graduate student workers|vulnerabilit\w*|next global cyberattack|crypto heist)\b', re.I)
RECOVERY = re.compile(r'\b(?:resum(?:e|es|ed)|reopen(?:ed|s)?|restor(?:es|ed)|returns? to normal|calls? off|called off|avert(?:ed|s|ing)|recover(?:s|ed)|ends? (?:the |its )?strike|strike ends?|strike averted|lifts? ground stop|services? remain operational|contains? cyberattack|postpon(?:e|es|ed)\b.*\baction)\b', re.I)
CYBER_EVENT = re.compile(r'\b(?:outage|hit|attack(?:ed)?|targeted|victim|investigat\w*|breach(?:ed)?|shuts?|shut(?:down)?|disrupt\w*|interrupt\w*|affect\w*|crippl\w*|compromis\w*|leak(?:ed)?|expos\w*|after|confirms?|suffer\w*)\b', re.I)
NO_ACTIVE_IMPACT = re.compile(r'\b(?:no (?:reports? of |known |material )?(?:(?:production|operational|service) )?(?:impact|disruption)|operations (?:are |remain )?(?:normal|unaffected)|typical victim|to prepare for|halt\w* demolition|work to restore|brought under control|prevented (?:a |the )?cyberattack|stops? cyberattack|targeted .{0,45}\bin (?:January|February|March|April|May|June|July|August|September|October|November|December),? official says)\b', re.I)
TRANSPORT = re.compile(r'\b(?:port|terminal|rail\w*|freight|cargo|shipping|supply chain|airline|airport|pipeline|border|deliveries|shipments|ferry|ferries|trucks?|logistics|canal|strait|shipping lane)\b', re.I)


def timestamp(dt):
    return dt.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def datetime_value(value):
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        try:
            dt = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
    return dt.astimezone(UTC) if dt and dt.tzinfo else None


def clean_title(value):
    return ' '.join(html.unescape(value or '').split())[:500]


def classify(title):
    if '?' in title or NOISE.search(title) or RECOVERY.search(title) or NO_ACTIVE_IMPACT.search(title):
        return None
    for category, pattern in PATTERNS.items():
        if category == 'cyber' and not CYBER_EVENT.search(title):
            continue
        if category == 'logistics' and not TRANSPORT.search(title):
            continue
        if pattern.search(title) and (category in ('cyber', 'financial', 'quality', 'logistics') or INDUSTRY.search(title)):
            return category
    return None


def safe_url(value):
    # All remote requests go to fixed index/authority URLs. Article links
    # are metadata only; strip tracking and never fetch linked articles.
    try:
        url = urlsplit(value)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or len(value) > 2000:
            return None
        if not re.fullmatch(r'[a-zA-Z0-9.-]+', url.hostname) or '.' not in url.hostname:
            return None
        query = urlencode([(k, v) for k, v in parse_qsl(url.query)
                           if not k.lower().startswith('utm_') and k.lower() not in ('fbclid', 'gclid')])
        return urlunsplit((url.scheme, url.netloc.lower(), url.path, query, ''))
    except ValueError:
        return None


def report(source, title, link, published, category, now, *, entities=()):
    url = safe_url(link)
    if not category or not url or not published or not now - HORIZON <= published <= now or not title:
        return None
    publisher = urlsplit(url).hostname.removeprefix('www.') if source == 'gdelt' else SOURCES[source][0]
    row = {'id': hashlib.sha256(url.encode()).hexdigest()[:20], 'sourceId': source,
           'title': title, 'url': url, 'publisher': publisher, 'publishedAt': timestamp(published), 'category': category}
    if entities:
        row['entities'] = list(entities)
    return row


def download(url, limit):
    request = Request(url, headers={'User-Agent': 'Supplier Atlas public-feed reader/1.0 (+https://github.com/KaptinOdium/supplier-atlas)'})
    with urlopen(request, timeout=20) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('The response exceeds the feed size limit')
    return data


def uk_recalls(now):
    rows = json.loads(download(UK_RECALLS, 1_500_000))['results']
    if not isinstance(rows, list):
        raise ValueError('Unsupported UK product safety feed')
    reports = []
    for row in rows:
        title = clean_title(row.get('title'))
        path = row.get('link', '')
        if not path.startswith('/product-safety-alerts-reports-recalls/'):
            continue
        found = report('uk-opss', title, urljoin('https://www.gov.uk/', path), datetime_value(row.get('public_timestamp')), 'quality', now)
        if found:
            reports.append(found)
    return len(rows), reports, 'Recent product safety notices published by the UK regulator.'


def atom_entries(url):
    data = download(url, 2_500_000)
    if b'<!DOCTYPE' in data.upper():
        raise ValueError('Unexpected XML document type')
    root = ElementTree.fromstring(data)
    if root.tag != '{http://www.w3.org/2005/Atom}feed':
        raise ValueError('Unsupported Atom feed')
    return root.findall('{*}entry')


class PageWords(HTMLParser):
    def __init__(self):
        super().__init__()
        self.words = []

    def handle_data(self, data):
        if data.strip():
            self.words.append(data.strip())


def transport_canada(now):
    items = atom_entries(CA_RECALLS)
    rows = []
    attempted = failed = 0
    for item in items:
        title = clean_title(item.findtext('{*}title'))
        updated = datetime_value(item.findtext('{*}updated'))
        link = item.find("{*}link[@rel='alternate']")
        url = link.get('href', '') if link is not None else ''
        if not updated or updated < now - HORIZON or not re.fullmatch(r'https://wwwapps\.tc\.gc\.ca/saf-sec-sur/7/vrdb-bdrv/search-recherche/detail\.aspx\?lang=eng&rn=\d{7,9}', url, re.I):
            continue
        # Atom supplies an edit timestamp. Use the regulator's original recall
        # date on the linked record so republication cannot reopen old recalls.
        attempted += 1
        try:
            page = PageWords()
            page.feed(download(url, 500_000).decode('utf-8', 'replace'))
            index = page.words.index('Recall Date')
            date = datetime.strptime(page.words[index + 1], '%Y-%m-%d').replace(tzinfo=UTC)
        except RECORD_ERRORS:
            failed += 1
            continue
        subject = re.fullmatch(r'(.{2,120}?) issued a recall on .+', title, re.I)
        found = report('ca-transport', title, url, date, 'quality', now, entities=[subject[1]] if subject else [])
        if found:
            found['datePrecision'] = 'day'
            rows.append(found)
    if failed and failed == attempted:
        raise ValueError('Original recall dates unavailable')
    detail = 'Vehicle, tire and child-seat notices dated by the original Transport Canada recall.'
    if failed:
        detail += f' Partial coverage: {failed} original recall dates unavailable.'
    return len(items), rows, detail


def gazette_date(value):
    date = datetime.fromisoformat(value)
    if date.tzinfo:
        return date
    try:
        return date.replace(tzinfo=ZoneInfo('Europe/London'))
    except ZoneInfoNotFoundError:
        # Britain advances on the last Sunday in March and returns on the
        # last Sunday in October. Select the first occurrence in the fold.
        def last_sunday(month):
            end = datetime(date.year, month, monthrange(date.year, month)[1], 2)
            return end - timedelta(days=(end.weekday() + 1) % 7)
        british_summer_time = last_sunday(3) <= date < last_sunday(10)
        return date.replace(tzinfo=timezone(timedelta(hours=int(british_summer_time))))


def corporate_administrations(now):
    items = atom_entries(GAZETTE)
    rows = []
    for item in items:
        if item.findtext('{*}notice-code') != '2410':
            continue
        # Keep legal company names only, never personal insolvency notices,
        # named administrators, addresses, or an unverified trading address.
        entity = clean_title(item.findtext('{*}title'))
        url = next((x.get('href') for x in item.findall('{*}link') if re.fullmatch(
            r'https://www\.thegazette\.co\.uk/notice/\d+', x.get('href', ''))), None)
        if not entity or not url:
            continue
        try:
            date = gazette_date(item.findtext('{*}published') or '')
        except ValueError:
            continue
        found = report('uk-gazette', f'{entity}: appointment of administrators', url, date, 'financial', now, entities=[entity])
        if found:
            rows.append(found)
    return len(items), rows, 'Corporate appointment-of-administrators notices (2410), dated by publication in The Gazette.'


def gkg_quarter(key, now):
    raw = download(GDELT + key + '.gkg.csv.zip', 20_000_000)
    reports = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].file_size > 140_000_000:
            raise ValueError('Unsupported GDELT archive')
        with archive.open(members[0]) as stream:
            for line in stream:
                cols = line.rstrip(b'\r\n').split(b'\t')
                if len(cols) < 27:
                    continue
                total += 1
                extras = cols[26]
                title = re.search(rb'<PAGE_TITLE>(.*?)</PAGE_TITLE>', extras)
                if not title:
                    continue
                headline = clean_title(title[1].decode('utf-8', 'replace'))
                category = classify(headline)
                if not category:
                    continue
                pub = re.search(rb'<PAGE_PRECISEPUBTIMESTAMP>(\d{14})</PAGE_PRECISEPUBTIMESTAMP>', extras)
                if not pub:
                    continue
                try:
                    published = datetime.strptime(pub[1].decode('ascii'), '%Y%m%d%H%M%S').replace(tzinfo=UTC)
                except ValueError:
                    continue
                found = report('gdelt', headline, cols[4].decode('utf-8', 'replace'), published, category, now)
                if found:
                    reports.append(found)
    return total, reports


def gdelt(now, previous):
    manifest = download(GDELT + 'lastupdate.txt', 12_000).decode('ascii')
    latest = re.search(r'/(\d{14})\.gkg\.csv\.zip', manifest)
    if not latest:
        raise ValueError('GDELT archive index did not include the news file')
    end = datetime.strptime(latest[1], '%Y%m%d%H%M%S').replace(tzinfo=UTC)
    if end < now - timedelta(hours=12) or end > now + timedelta(minutes=15):
        raise ValueError('GDELT archive index is outside the current ingestion window')
    coverage = next((x for x in previous.get('coverage', []) if x.get('id') == 'gdelt'), {})
    earlier = datetime_value(coverage.get('latestArchive'))
    # On first run, sample one quarter per hour over three days. Thereafter
    # read every quarter since the last scan, with overlap for late files.
    if earlier and now - HORIZON < earlier <= end and end - earlier < timedelta(hours=15):
        quarters = min(64, int((end - earlier) / timedelta(minutes=15)) + 5)
        times = [end - timedelta(minutes=15 * i) for i in range(quarters)]
    else:
        times = [end - timedelta(hours=i) for i in range(72)]
    expired = (now - HORIZON).strftime('%Y%m%d%H%M%S')
    retry = {k for k in coverage.get('retryArchives', []) if isinstance(k, str) and re.fullmatch(r'\d{14}', k) and k >= expired}
    keys = sorted({t.strftime('%Y%m%d%H%M%S') for t in times} | set(sorted(retry)[:12]))
    def fetch(key):
        try:
            return gkg_quarter(key, now)
        except NETWORK_ERRORS:
            return None
    reports, received, completed = [], 0, []
    with ThreadPoolExecutor(max_workers=3) as executor:
        for key, result in zip(keys, executor.map(fetch, keys)):
            if result is None:
                retry.add(key)
                continue
            completed.append(key)
            retry.discard(key)
            received += result[0]
            reports.extend(result[1])
    if not completed:
        raise ValueError('No current GDELT archive could be read')
    detail = f'Sampled {len(completed)}/{len(keys)} selected 15-minute English-language world-news archives this run. Earlier eligible headlines are retained for 72 hours. Only articles with a publisher timestamp and a qualifying headline are included.'
    if retry:
        detail += f' Partial coverage: {len(retry)} recent archives await retry.'
    latest_read = datetime.strptime(max(completed), '%Y%m%d%H%M%S').replace(tzinfo=UTC)
    return received, reports, detail, timestamp(max(latest_read, earlier) if earlier else latest_read), sorted(retry)


def make_feed(now, previous):
    candidates = [r for r in previous.get('reports', []) if r.get('sourceId') in SOURCES
                  and (dt := datetime_value(r.get('publishedAt'))) and now - HORIZON <= dt <= now
                  and (r['sourceId'] != 'gdelt' or classify(r.get('title', '')) == r.get('category'))]
    coverage = []
    for source, (name, url) in SOURCES.items():
        status = {'id': source, 'name': name, 'url': url, 'checkedAt': timestamp(now), 'received': 0, 'retained': 0}
        old = next((x for x in previous.get('coverage', []) if x.get('id') == source), {})
        try:
            if source == 'gdelt':
                received, reports, detail, status['latestArchive'], status['retryArchives'] = gdelt(now, previous)
            else:
                readers = {'uk-opss': uk_recalls, 'ca-transport': transport_canada, 'uk-gazette': corporate_administrations}
                received, reports, detail = readers[source](now)
            status.update(status='ok', received=received, detail=detail, lastSuccessAt=timestamp(now))
            candidates.extend(reports)
        except NETWORK_ERRORS as exc:
            for field in ('latestArchive', 'retryArchives', 'lastSuccessAt'):
                if field in old:
                    status[field] = old[field]
            status.update(status='unavailable', detail=f'Source unavailable on this run ({type(exc).__name__}). Earlier reports within 72 hours may still be listed.')
        coverage.append(status)
    # Keep recent evidence from each category even during a burst of recalls.
    unique = {}
    for row in candidates:
        unique[row['id']] = row
    # Prefer regulator notices over verbatim syndication. For wire copies of
    # the same headline, use the earliest published copy within the window.
    distinct = {}
    for row in sorted(unique.values(), key=lambda r: (r['sourceId'] == 'gdelt', r['publishedAt'], r['url'])):
        headline = ' '.join(re.findall(r'\w+', row['title'].casefold()))
        distinct.setdefault((row['category'], headline), row)
    result = []
    for category in PATTERNS:
        recent = sorted((r for r in distinct.values() if r['category'] == category),
                        key=lambda r: (r['publishedAt'], r['id']), reverse=True)
        result.extend(recent[:180])
    result.sort(key=lambda r: (r['publishedAt'], r['id']), reverse=True)
    for item in coverage:
        item['retained'] = sum(r['sourceId'] == item['id'] for r in result)
    if any(run['status'] == 'ok' for run in coverage):
        generated = timestamp(now)
    elif previous.get('generatedAt'):
        generated = previous['generatedAt']
    else:
        raise RuntimeError('All public sources unavailable; no initial snapshot could be produced.')
    return {'version': 1, 'generatedAt': generated, 'lastAttemptAt': timestamp(now), 'coverage': coverage, 'reports': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('docs/data/operational-risks.json'))
    args = parser.parse_args()
    previous = json.loads(args.output.read_text('utf-8')) if args.output.exists() else {}
    feed = make_feed(datetime.now(UTC), previous)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=args.output.parent, delete=False) as tmp:
        json.dump(feed, tmp, ensure_ascii=False, separators=(',', ':'))
        tmp.write('\n')
    os.replace(tmp.name, args.output)
    for source in feed['coverage']:
        print(f"{source['name']}: {source['status']}, {source['received']} read, {source['retained']} retained.")


if __name__ == '__main__':
    main()
