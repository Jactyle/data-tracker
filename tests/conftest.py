import pytest

from tracker.sources import imdb


@pytest.fixture(autouse=True)
def restore_film_info():
    """Tests register made-up films in imdb.FILM_INFO; put the real list back afterwards."""
    saved = dict(imdb.FILM_INFO)
    yield
    imdb.FILM_INFO.clear()
    imdb.FILM_INFO.update(saved)
