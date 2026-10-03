#!/usr/bin/env ruby
# encoding: utf-8
require 'json'
require 'time'
require 'pathname'
require 'shellwords'
require 'tmpdir'
require 'rexml/document'

root = Pathname.new(__dir__)
assets = root + 'assets'
xlsx = root + 'dati_foto.xlsx'
raise "Missing #{xlsx}" unless xlsx.file?

def haversine_m(a, b)
  dy = (a[:lat] - b[:lat]) * 111_320.0
  dx = (a[:lon] - b[:lon]) * 111_320.0 * Math.cos(a[:lat] * Math::PI / 180.0)
  Math.sqrt(dx * dx + dy * dy)
end

def excel_serial_to_date(serial)
  # Excel / Numbers serial days since 1899-12-30
  Time.utc(1899, 12, 30) + (serial.to_f * 86400)
end

def parse_dati_foto(path)
  Dir.mktmpdir('dati_foto') do |tmp|
    system('unzip', '-qq', '-o', path.to_s, '-d', tmp) || raise('unzip failed')
    strings = []
    ss = File.join(tmp, 'xl/sharedStrings.xml')
    if File.exist?(ss)
      doc = REXML::Document.new(File.read(ss))
      doc.elements.each('sst/si') do |si|
        texts = []
        si.elements.each('.//t') { |t| texts << t.text.to_s }
        strings << texts.join
      end
    end

    sheet = REXML::Document.new(File.read(File.join(tmp, 'xl/worksheets/sheet1.xml')))
    rows = []
    sheet.elements.each('worksheet/sheetData/row') do |row|
      cells = {}
      row.elements.each('c') do |c|
        ref = c.attributes['r']
        col = ref[/^[A-Z]+/]
        type = c.attributes['t']
        v = c.elements['v']
        next unless v
        raw = v.text
        val = if type == 's'
                strings[raw.to_i]
              else
                raw.to_f
              end
        cells[col] = val
      end
      rows << cells
    end

    # skip header + note rows
    data = []
    rows.drop(1).each do |cells|
      next unless cells['A']
      next if cells['A'].is_a?(String) && cells['A'] =~ /Note:/i
      next unless cells['D'] # needs luma at least

      id = cells['A']
      id = id.to_i == id.to_f ? id.to_i : id
      date_serial = cells['B']
      time_frac = cells['C']
      next if date_serial.nil? || time_frac.nil? || time_frac.is_a?(String)

      day = excel_serial_to_date(date_serial.to_i)
      secs = (time_frac.to_f * 86400).round
      # Local CEST (+02:00) wall clock from spreadsheet
      local = Time.new(day.year, day.month, day.day, 0, 0, 0, '+02:00') + secs

      data << {
        numero: id,
        timeLocal: local.strftime('%Y-%m-%dT%H:%M:%S'),
        time: local.utc.iso8601,
        luma: cells['D'].to_f,
        light: cells['E'].to_f,   # rosso / luminosità
        shadow: cells['F'].to_f,  # blu / buio
        neutral: cells['G'].to_f  # grigio / intermezzo
      }
    end
    data
  end
end

def list_images(dir)
  Dir.children(dir).reject { |n| n.start_with?('.') || File.directory?(dir + n) }.map do |name|
    path = dir + name
    birth = `stat -f "%SB" -t "%Y-%m-%dT%H:%M:%S" #{Shellwords.escape(path.to_s)}`.strip
    { name: name, path: path, birth: birth, t: Time.parse("#{birth}+02:00") }
  end
end

def resolve_image(foto, images)
  n = foto[:numero]
  candidates = []
  if n.is_a?(Numeric) || n.to_s =~ /^\d+$/
    num = n.to_i
    %w[.jpg .JPG .jpeg .png .PNG].each do |ext|
      hit = images.find { |i| i[:name] == "#{num}#{ext}" }
      candidates << hit if hit
    end
  else
    hit = images.find { |i| File.basename(i[:name], '.*') == n.to_s }
    candidates << hit if hit
  end
  return candidates.first if candidates.any?

  # fallback: closest birth time
  target = Time.parse(foto[:time])
  images.min_by { |i| (i[:t] - target).abs }
end

# --- GPX ---
gpx = (assets + 'Peak Prompt.gpx').read
pts = []
gpx.scan(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">\s*<ele>([^<]+)<\/ele>\s*<time>([^<]+)<\/time>/) do |lat, lon, ele, time|
  pts << { lat: lat.to_f, lon: lon.to_f, ele: ele.to_f, time: time, t: Time.parse(time) }
end
raise 'No trackpoints' if pts.empty?

cum = [0.0]
(1...pts.size).each { |i| cum << cum[-1] + haversine_m(pts[i - 1], pts[i]) }

# downsample track for 3D
step = [pts.size / 400, 1].max
track = pts.each_with_index.select { |_, i| i % step == 0 || i == pts.size - 1 }.map do |p, i|
  { lat: p[:lat], lon: p[:lon], ele: p[:ele], time: p[:time], km: (cum[i] / 1000.0).round(3) }
end

images_dir = assets + 'images'
images = list_images(images_dir)
fotos = parse_dati_foto(xlsx)

media = fotos.map do |foto|
  img = resolve_image(foto, images)
  mt = Time.parse(foto[:time])
  best_i = pts.each_with_index.min_by { |p, _| (p[:t] - mt).abs }[1]
  best = pts[best_i]
  delta = (best[:t] - mt).abs

  stem = img ? File.basename(img[:name], '.*') : nil
  {
    id: "foto-#{foto[:numero]}",
    numero: foto[:numero],
    name: img ? img[:name] : "foto #{foto[:numero]}",
    src: img ? "assets/images/#{img[:name]}" : nil,
    shadeSrc: stem && (assets + "images/solo_rosso_blu/#{stem}_rosso_blu.png").file? ?
      "assets/images/solo_rosso_blu/#{stem}_rosso_blu.png" : nil,
    redSrc: stem && (assets + "images/livelli_rosso_blu/#{stem}_rosso.png").file? ?
      "assets/images/livelli_rosso_blu/#{stem}_rosso.png" : nil,
    blueSrc: stem && (assets + "images/livelli_rosso_blu/#{stem}_blu.png").file? ?
      "assets/images/livelli_rosso_blu/#{stem}_blu.png" : nil,
    time: foto[:time],
    timeLocal: foto[:timeLocal],
    luma: foto[:luma].round(4),
    light: foto[:light].round(4),
    shadow: foto[:shadow].round(4),
    neutral: foto[:neutral].round(4),
    match: {
      time: best[:time],
      lat: best[:lat],
      lon: best[:lon],
      ele: best[:ele].round(1),
      km: (cum[best_i] / 1000.0).round(3),
      deltaSec: delta.to_i
    }
  }
end.sort_by { |m| Time.parse(m[:time]) }

out = {
  title: 'Falzarego',
  gpxStart: pts.first[:time],
  gpxEnd: pts.last[:time],
  trackKm: (cum.last / 1000.0).round(2),
  elevMin: pts.map { |p| p[:ele] }.min.round(1),
  elevMax: pts.map { |p| p[:ele] }.max.round(1),
  track: track,
  photos: media
}

File.write(root + 'assets-data.json', JSON.pretty_generate(out))
puts "Track: #{pts.size} pts → #{track.size} embedded, #{out[:trackKm]} km"
puts "Photos from dati_foto: #{media.size}"
media.first(3).each { |m| puts "  #{m[:numero]} #{m[:name]} light=#{m[:light]} shadow=#{m[:shadow]} neutral=#{m[:neutral]} @ #{m[:match][:km]}km" }
puts 'Wrote assets-data.json'
