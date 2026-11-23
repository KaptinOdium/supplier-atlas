import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import collect_operational_risks as feed


NOW = datetime(2026, 11, 23, 12, tzinfo=timezone.utc)


class CollectorTests(unittest.TestCase):
    def test_current_operational_headlines_and_exclusions(self):
        for title, category in [
            ('Operator halts production at assembly plant', 'production'),
            ('Rail workers begin strike at freight terminal', 'labor'),
            ('Port closure delays deliveries at two terminals', 'logistics'),
            ('Parts maker confirms cyberattack that disrupted operations', 'cyber'),
            ('Automaker issues safety recall', 'quality'),
            ('Industrial manufacturer files for bankruptcy', 'financial'),
            ('A century later, mine explosion is memorialized', None),
            ('Ports resume operations after dock strike', None),
            ('Operator stops cyberattack with no reports of production disruption', None),
            ('Research highlights the next global cyberattack', None),
            ('Airport strike price in a fantasy football game', None),
            ('Railway halts demolition of old offices', None),
        ]:
            with self.subTest(title=title):
                self.assertEqual(feed.classify(title), category)

    def test_evidence_date_and_reference(self):
        def make(days, url):
            return feed.report('gdelt', 'Plant shutdown', url, NOW - timedelta(days=days), 'production', NOW)
        self.assertIsNone(make(4, 'https://example.com/notice'))
        self.assertIsNone(make(-1, 'https://example.com/notice'))
        self.assertIsNone(make(1, 'javascript:alert(1)'))
        self.assertEqual(make(1, 'https://example.com/notice?utm_source=rss')['url'], 'https://example.com/notice')

    def test_syndication_and_failed_full_refresh(self):
        first = feed.report('gdelt', 'Example factory fire', 'https://example.org/first', NOW - timedelta(hours=9), 'production', NOW)
        later = feed.report('gdelt', 'Example factory fire', 'https://example.net/wire', NOW - timedelta(hours=2), 'production', NOW)
        mock_source = {'gdelt': feed.SOURCES['gdelt']}
        with patch.object(feed, 'SOURCES', mock_source):
            with patch.object(feed, 'gdelt', return_value=(7, [first, later], 'Checked.', feed.timestamp(NOW), [])):
                current = feed.make_feed(NOW, {})
                self.assertEqual(current['reports'], [first])
            with patch.object(feed, 'gdelt', side_effect=OSError('offline')):
                fallback = feed.make_feed(NOW + timedelta(hours=1), current)
                self.assertEqual(fallback['reports'], [first])
                self.assertEqual(fallback['generatedAt'], current['generatedAt'])
                self.assertEqual(fallback['coverage'][0]['status'], 'unavailable')
                self.assertEqual(fallback['lastAttemptAt'], feed.timestamp(NOW + timedelta(hours=1)))
                with self.assertRaises(RuntimeError):
                    feed.make_feed(NOW, {})

    def test_canada_uses_original_recall_date_and_explicit_subject(self):
        atom = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>EXAMPLE MFG issued a recall on its vehicles</title>
          <updated>2026-11-23T06:00:00-05:00</updated>
          <link rel="alternate" href="https://wwwapps.tc.gc.ca/Saf-Sec-Sur/7/VRDB-BDRV/search-recherche/detail.aspx?lang=eng&amp;rn=2026123"/>
          </entry></feed>'''
        for date, expected in [('2026-11-10', 0), ('2026-11-22', 1)]:
            with patch.object(feed, 'download', side_effect=[atom, f'<dt>Recall Date</dt><dd>{date}</dd>'.encode()]):
                _, rows, _ = feed.transport_canada(NOW)
                self.assertEqual(len(rows), expected)
                if rows:
                    self.assertEqual(rows[0]['datePrecision'], 'day')
                    self.assertEqual(rows[0]['entities'], ['EXAMPLE MFG'])

    def test_uk_date_on_hosts_without_iana_data(self):
        with patch.object(feed, 'ZoneInfo', side_effect=feed.ZoneInfoNotFoundError):
            self.assertEqual(feed.timestamp(feed.gazette_date('2026-11-20T17:11:27')), '2026-11-20T17:11:27Z')
            self.assertEqual(feed.timestamp(feed.gazette_date('2026-08-20T17:11:27')), '2026-08-20T16:11:27Z')

    def test_unavailable_archives_are_retried_without_advancing_past_them_as_checked(self):
        previous = {'coverage': [{'id': 'gdelt', 'latestArchive': feed.timestamp(NOW - timedelta(minutes=30)),
                                  'retryArchives': ['20261122000000']}]}
        manifest = b'1000 hash http://data.gdeltproject.org/gdeltv2/20261123120000.gkg.csv.zip'

        def quarter(key, unused_now):
            if key == '20261123120000':
                raise OSError('not yet published')
            return 2, []

        with patch.object(feed, 'download', return_value=manifest), patch.object(feed, 'gkg_quarter', side_effect=quarter) as fetch:
            _, _, note, cursor, retry = feed.gdelt(NOW, previous)
            self.assertIn('Partial coverage', note)
            self.assertEqual(cursor, '2026-11-23T11:45:00Z')
            self.assertEqual(retry, ['20261123120000'])
            self.assertIn('20261122000000', {call.args[0] for call in fetch.call_args_list})


if __name__ == '__main__':
    unittest.main()
