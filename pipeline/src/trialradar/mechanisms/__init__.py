"""Drug → mechanism mapping from ChEMBL (hand-run via ``scripts/map_mechanisms.py``).

The daily pipeline only reads the committed CSVs through :mod:`trialradar.mechanisms.io`;
it never calls ChEMBL.
"""
