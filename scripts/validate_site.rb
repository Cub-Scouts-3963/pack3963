#!/usr/bin/env ruby

require "yaml"
require "pathname"
require "uri"

ROOT = Pathname.new(File.expand_path("..", __dir__))
errors = []

def load_yaml(path)
  YAML.safe_load(path.read, aliases: false)
end

html_files = ROOT.glob("*.html")

html_files.each do |path|
  source = path.read
  front_matter = source.match(/\A---\s*\n(.*?)\n---\s*\n/m)
  unless front_matter
    errors << "#{path.basename}: missing YAML front matter"
    next
  end

  metadata = YAML.safe_load(front_matter[1], aliases: false) || {}
  errors << "#{path.basename}: must use the default layout" unless metadata["layout"] == "default"

  {
    "html" => /<html(?:\s|>)/i,
    "head" => /<head(?:\s|>)/i,
    "body" => /<body(?:\s|>)/i
  }.each do |wrapper_name, pattern|
    errors << "#{path.basename}: contains duplicated #{wrapper_name} markup" if source.match?(pattern)
  end

  errors << "#{path.basename}: contains page-level analytics" if source.include?("googletagmanager.com")
  errors << "#{path.basename}: contains obsolete forms.css reference" if source.include?("forms.css")

  source.scan(/<a\b[^>]*target=["']_blank["'][^>]*>/im).each do |tag|
    rel = tag[/rel=["']([^"']*)["']/i, 1].to_s.split
    errors << "#{path.basename}: target=_blank link is missing rel protections" unless %w[noopener noreferrer].all? { |value| rel.include?(value) }
  end

  source.scan(/(?:href|src)=["']([^"']+)["']/i).flatten.each do |reference|
    next if reference.empty? || reference.start_with?("#", "{{")
    next if reference.match?(/\A(?:https?:|mailto:|tel:|data:)/i)

    clean_reference = reference.split(/[?#]/, 2).first.sub(%r{\A/}, "")
    next if clean_reference.empty?
    errors << "#{path.basename}: missing local reference #{reference}" unless (ROOT / clean_reference).exist?
  end
end

pack_path = ROOT / "_data/pack.yml"
pack = load_yaml(pack_path)
%w[name short_name city state email phone registration_url meeting].each do |key|
  errors << "_data/pack.yml: missing #{key}" if pack[key].nil? || pack[key].to_s.empty?
end
%w[venue street city_state_zip schedule].each do |key|
  errors << "_data/pack.yml: meeting is missing #{key}" if pack.dig("meeting", key).nil? || pack.dig("meeting", key).to_s.empty?
end

events = load_yaml(ROOT / "_data/events.yml")
event_list = events.fetch("events", [])
errors << "_data/events.yml: at least one event is required" if event_list.empty?
errors << "_data/events.yml: exactly one featured event is required" unless event_list.count { |event| event["featured"] } == 1
event_list.each_with_index do |event, index|
  %w[id date date_label title time location description].each do |key|
    errors << "_data/events.yml: event #{index + 1} is missing #{key}" if event[key].nil? || event[key].to_s.empty?
  end
end

community_events_path = ROOT / "_data/community_events.yml"
community_events = load_yaml(community_events_path)
community_event_list = community_events.fetch("events", [])
errors << "_data/community_events.yml: at least one community event is required" if community_event_list.empty?
community_event_list.each_with_index do |event, index|
  %w[id date date_label title time location organizer description].each do |key|
    errors << "_data/community_events.yml: event #{index + 1} is missing #{key}" if event[key].nil? || event[key].to_s.empty?
  end
end
community_events.fetch("resources", []).each_with_index do |resource, index|
  %w[title image alt end_date].each do |key|
    errors << "_data/community_events.yml: resource #{index + 1} is missing #{key}" if resource[key].nil? || resource[key].to_s.empty?
  end
  image = resource["image"].to_s.sub(%r{\A/}, "")
  errors << "_data/community_events.yml: missing resource image #{image}" unless (ROOT / image).file?
end

photo_data = load_yaml(ROOT / "_data/photos.yml")
photos = photo_data.fetch("photos", [])
seen_photos = {}
photos.each_with_index do |photo, index|
  file = photo["file"].to_s.sub(%r{\A/}, "")
  errors << "_data/photos.yml: photo #{index + 1} is missing a file" if file.empty?
  errors << "_data/photos.yml: photo #{index + 1} is missing descriptive alt text" if photo["alt"].to_s.strip.empty?
  errors << "_data/photos.yml: duplicate photo #{file}" if seen_photos[file]
  seen_photos[file] = true
  errors << "_data/photos.yml: missing image #{file}" unless (ROOT / file).file?
end

forbidden = [ROOT / ".DS_Store", ROOT / "assets/.DS_Store", ROOT / "style.css"]
forbidden.each { |path| errors << "Forbidden file exists: #{path.relative_path_from(ROOT)}" if path.exist? }
ROOT.glob("assets/images/pack3963photos/*.{heic,HEIC}").each do |path|
  errors << "HEIC image must be converted for the web: #{path.relative_path_from(ROOT)}"
end

if errors.empty?
  puts "Site validation passed: #{html_files.length} pages, #{event_list.length} Pack events, #{community_event_list.length} community events, and #{photos.length} photos checked."
else
  warn "Site validation failed:"
  errors.each { |error| warn "- #{error}" }
  exit 1
end
