import { useEffect, useState } from 'react';
import {
  deleteLandingPageSlide,
  loadLandingPageSlides,
  saveLandingSlideshowVisibility,
  updateLandingPageSlide,
  uploadLandingPageSlide,
  reorderLandingPageSlides,
} from './igoDatabase';
import './LandingSlideshow.css';

const advanceSlide = (current, amount, length) => (current + amount + length) % length;

export function PublicLandingSlideshow({ visible }) {
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let active = true;
    if (!visible) {
      setSlides([]);
      setActiveIndex(0);
      return () => { active = false; };
    }
    loadLandingPageSlides(false)
      .then((items) => {
        if (!active) return;
        setSlides(items);
        setActiveIndex(0);
      })
      .catch((error) => console.error('Could not load public landing slides:', error));
    return () => { active = false; };
  }, [visible]);

  useEffect(() => {
    if (!visible || paused || slides.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => advanceSlide(index, 1, slides.length));
    }, 6000);
    return () => window.clearInterval(timer);
  }, [visible, paused, slides.length]);

  if (!visible || !slides.length) return null;
  const slide = slides[activeIndex];

  return (
    <section className="public-slideshow" aria-labelledby="public-slideshow-title">
      <h2 id="public-slideshow-title">Updates from iGO</h2>
      <div className="public-slideshow-frame" aria-roledescription="carousel" aria-label="iGO image slideshow">
        <img key={slide.id} src={slide.imageUrl} alt={slide.alt_text || ''} />
        {slide.caption && <p className="public-slideshow-caption">{slide.caption}</p>}
        {slides.length > 1 && <>
          <button className="public-slideshow-arrow public-slideshow-previous" type="button" aria-label="Previous slide" onClick={() => setActiveIndex((index) => advanceSlide(index, -1, slides.length))}>‹</button>
          <button className="public-slideshow-arrow public-slideshow-next" type="button" aria-label="Next slide" onClick={() => setActiveIndex((index) => advanceSlide(index, 1, slides.length))}>›</button>
          <div className="public-slideshow-controls">
            <div className="public-slideshow-dots" aria-label="Choose slide">
              {slides.map((item, index) => <button key={item.id} type="button" aria-label={`Show slide ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setActiveIndex(index)} />)}
            </div>
            <button className="public-slideshow-pause" type="button" onClick={() => setPaused((value) => !value)}>{paused ? 'Play' : 'Pause'}</button>
          </div>
        </>}
      </div>
    </section>
  );
}

export function SuperadminLandingSlideshowManager({ visible, onVisibilityChange }) {
  const [slides, setSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busySlideId, setBusySlideId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setSlides(await loadLandingPageSlides(true));
    } catch (loadError) {
      setError(loadError.message || 'Could not load slideshow images.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const changeVisibility = async (event) => {
    const nextValue = event.target.checked;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await saveLandingSlideshowVisibility(nextValue);
      onVisibilityChange(nextValue);
      setMessage(nextValue ? 'The slideshow card is visible to visitors.' : 'The slideshow card is hidden from visitors.');
    } catch (saveError) {
      setError(saveError.message || 'Could not update slideshow visibility.');
    } finally {
      setBusy(false);
    }
  };

  const addSlide = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('slide_image');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await uploadLandingPageSlide({
        file,
        altText: String(values.get('alt_text') || '').trim(),
        caption: String(values.get('caption') || '').trim(),
      });
      form.reset();
      setMessage('Image added to the slideshow.');
      await refresh();
    } catch (uploadError) {
      setError(uploadError.message || 'Could not add the image.');
    } finally {
      setBusy(false);
    }
  };

  const updateSlide = async (event, slide) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusySlideId(slide.id);
    setError('');
    setMessage('');
    try {
      await updateLandingPageSlide(slide.id, {
        alt_text: String(values.get('alt_text') || '').trim(),
        caption: String(values.get('caption') || '').trim(),
      });
      setMessage('Slide details saved.');
      await refresh();
    } catch (saveError) {
      setError(saveError.message || 'Could not save slide details.');
    } finally {
      setBusySlideId('');
    }
  };

  const toggleSlide = async (slide, isVisible) => {
    setBusySlideId(slide.id);
    setError('');
    setMessage('');
    try {
      await updateLandingPageSlide(slide.id, { is_visible: isVisible });
      setSlides((current) => current.map((item) => item.id === slide.id ? { ...item, is_visible: isVisible } : item));
      setMessage(isVisible ? 'Slide is visible.' : 'Slide is hidden.');
    } catch (saveError) {
      setError(saveError.message || 'Could not update slide visibility.');
    } finally {
      setBusySlideId('');
    }
  };

  const moveSlide = async (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= slides.length) return;
    const reordered = [...slides];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    setSlides(reordered);
    setBusy(true);
    setError('');
    try {
      await reorderLandingPageSlides(reordered.map((slide) => slide.id));
    } catch (saveError) {
      setError(saveError.message || 'Could not change slide order.');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeSlide = async (slide) => {
    if (!window.confirm('Remove this image from the slideshow?')) return;
    setBusySlideId(slide.id);
    setError('');
    setMessage('');
    try {
      await deleteLandingPageSlide(slide.id);
      setSlides((current) => current.filter((item) => item.id !== slide.id));
      setMessage('Slide removed.');
    } catch (deleteError) {
      setError(deleteError.message || 'Could not remove this slide.');
    } finally {
      setBusySlideId('');
    }
  };

  return (
    <section className="card landing-slide-manager" aria-labelledby="landing-slide-manager-title">
      <div>
        <p className="eyebrow">PUBLIC WEBSITE</p>
        <h2 id="landing-slide-manager-title">Landing page slideshow</h2>
        <p>Upload images, order them, and choose which ones visitors can see.</p>
      </div>
      <label className="landing-slide-visibility">
        <input type="checkbox" checked={visible} disabled={busy} onChange={changeVisibility} />
        Show slideshow card on the public landing page
      </label>
      <form className="landing-slide-upload" onSubmit={addSlide}>
        <label>Slide image
          <input name="slide_image" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} />
        </label>
        <label>Alternative text
          <input name="alt_text" required maxLength={240} placeholder="Describe the image for screen readers" disabled={busy} />
        </label>
        <label>Caption (optional)
          <input name="caption" maxLength={160} placeholder="Short text shown over the image" disabled={busy} />
        </label>
        <small>Use a wide 16:9 image. Recommended: 1600 × 900 pixels. JPG, PNG, or WebP, up to 8 MB.</small>
        <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add image'}</button>
      </form>
      {loading && <p>Loading slides…</p>}
      {!loading && slides.length === 0 && <p>No slideshow images yet.</p>}
      <div className="landing-slide-list">
        {slides.map((slide, index) => (
          <article className="landing-slide-item" key={slide.id}>
            <img src={slide.imageUrl} alt="" />
            <form onSubmit={(event) => updateSlide(event, slide)}>
              <label>Alternative text<input name="alt_text" defaultValue={slide.alt_text} required maxLength={240} disabled={busySlideId === slide.id} /></label>
              <label>Caption<input name="caption" defaultValue={slide.caption || ''} maxLength={160} disabled={busySlideId === slide.id} /></label>
              <label className="landing-slide-visibility"><input type="checkbox" checked={slide.is_visible} disabled={busySlideId === slide.id} onChange={(event) => void toggleSlide(slide, event.target.checked)} /> Show this slide</label>
              <div className="landing-slide-actions">
                <button type="button" className="secondary-btn" aria-label="Move slide up" disabled={busy || index === 0} onClick={() => void moveSlide(index, -1)}>Move up</button>
                <button type="button" className="secondary-btn" aria-label="Move slide down" disabled={busy || index === slides.length - 1} onClick={() => void moveSlide(index, 1)}>Move down</button>
                <button type="submit" className="secondary-btn" disabled={busySlideId === slide.id}>{busySlideId === slide.id ? 'Saving…' : 'Save details'}</button>
                <button type="button" className="secondary-btn" disabled={busySlideId === slide.id} onClick={() => void removeSlide(slide)}>Remove</button>
              </div>
            </form>
          </article>
        ))}
      </div>
      {message && <p className="landing-slide-status" role="status">{message}</p>}
      {error && <p className="landing-slide-error" role="alert">{error}</p>}
    </section>
  );
}
